//! 插件服务：registry 拉取、下载（SHA-256 边下边校验）、解压安装、卸载、
//! 已安装列表与插件文件读取。安装布局（跟随应用所在目录，即安装目录或
//! 便携 exe 同级；目录不可写时回退 %LOCALAPPDATA%）：
//!
//! ```text
//! <应用目录>/
//! ├── ToolBox.exe
//! ├── plugins/                      # 工具
//! │   ├── installed.json            # { "<id>": "<version>" }
//! │   └── <id>/<version>/           # manifest.json + module.js + style.css
//! ├── capabilities/                 # 共享能力（wasm + 桥）
//! │   ├── installed.json            # { "<id>": "<version>" }
//! │   └── <id>/<version>/           # manifest.json + cap.wasm + bridge.js
//! └── cache/                        # 下载与解压暂存
//! ```
//!
//! 工具安装时自动补齐缺失的依赖能力；卸载工具后，无人引用的能力自动清除
//! （能力被多个工具共享，只保留一份）。

use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use super::types::{InstalledRecord, ManifestCore, RegistryDoc};
use crate::error::{AppError, AppResult};

const INSTALLED_FILE: &str = "installed.json";
/// 包类型 → 安装子目录。
const KIND_TOOLS: &str = "plugins";
const KIND_CAPS: &str = "capabilities";

fn kind_label(kind: &str) -> &'static str {
    if kind == KIND_CAPS {
        "能力"
    } else {
        "工具"
    }
}

/// exe 所在目录（可写时返回）。便携版/用户级安装目录可直接落盘，
/// 工具与主程序放在一起、跟随安装位置。
fn exe_dir_if_writable() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let probe = dir.join(".toolbox-write-probe");
    if fs::write(&probe, b"toolbox").is_ok() {
        let _ = fs::remove_file(&probe);
        return Some(dir);
    }
    None
}

fn data_root(app: &AppHandle) -> AppResult<PathBuf> {
    if let Some(dir) = exe_dir_if_writable() {
        return Ok(dir);
    }
    // 回退：机器级安装进 Program Files 等只读目录时使用用户数据目录。
    app.path()
        .app_local_data_dir()
        .map_err(|e| AppError::Other(format!("无法定位可写的数据目录: {e}")))
}

pub fn plugins_root(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(data_root(app)?.join(KIND_TOOLS))
}

fn capabilities_root(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(data_root(app)?.join(KIND_CAPS))
}

fn kind_root(app: &AppHandle, kind: &str) -> AppResult<PathBuf> {
    match kind {
        KIND_TOOLS => plugins_root(app),
        KIND_CAPS => capabilities_root(app),
        _ => Err(AppError::Invalid(format!("未知包类型 {kind}"))),
    }
}

fn cache_root(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(data_root(app)?.join("cache"))
}

/* ---- http ---- */

/// 两套 HTTP 客户端：优先走系统代理（部分网络必须代理才能访问 GitHub），
/// 连接失败时回退直连（部分代理规则会拦截 CDN 域名）。
fn http_clients() -> &'static (reqwest::blocking::Client, reqwest::blocking::Client) {
    static CLIENTS: OnceLock<(reqwest::blocking::Client, reqwest::blocking::Client)> =
        OnceLock::new();
    CLIENTS.get_or_init(|| {
        let make = |no_proxy: bool| {
            let mut b = reqwest::blocking::Client::builder()
                .user_agent(concat!("ToolBox/", env!("CARGO_PKG_VERSION")))
                .timeout(Duration::from_secs(30))
                .connect_timeout(Duration::from_secs(8));
            if no_proxy {
                b = b.no_proxy();
            }
            b.build().expect("failed to build http client")
        };
        (make(false), make(true))
    })
}

/// 带回退的 GET：系统代理 → 直连。错误信息包含完整错误链。
fn send_get(url: &str) -> AppResult<reqwest::blocking::Response> {
    let (proxied, direct) = http_clients();
    let mut errors: Vec<String> = Vec::new();
    for (label, client) in [("系统代理", proxied), ("直连", direct)] {
        match client.get(url).send() {
            Ok(resp) => return Ok(resp),
            Err(e) => errors.push(format!("{label}: {}", error_chain(&e))),
        }
    }
    Err(AppError::Other(format!(
        "网络请求失败（已尝试 {}）",
        errors.join("；")
    )))
}

/// 展开嵌套错误链，暴露根因（dns / tls / connect 等）。
fn error_chain(e: &dyn std::error::Error) -> String {
    let mut msg = e.to_string();
    let mut cur = e.source();
    while let Some(s) = cur {
        msg.push_str(&format!(" ← {s}"));
        cur = s.source();
    }
    msg
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn emit_progress(
    app: &AppHandle,
    kind: &str,
    id: &str,
    stage: &str,
    received: u64,
    total: u64,
) {
    let _ = app.emit(
        "plugin-install-progress",
        json!({ "kind": kind, "id": id, "stage": stage, "received": received, "total": total }),
    );
}

/* ---- registry ---- */

pub fn fetch_registry(url: &str) -> AppResult<RegistryDoc> {
    let resp = send_get(url).map_err(|e| AppError::Other(format!("请求 registry 失败: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Other(format!(
            "registry 响应异常: HTTP {}",
            resp.status()
        )));
    }
    resp.json()
        .map_err(|e| AppError::Other(format!("registry 解析失败: {e}")))
}

fn resolve_package_url(registry_url: &str, file: &str) -> AppResult<String> {
    let base = url::Url::parse(registry_url)
        .map_err(|e| AppError::Invalid(format!("registry 地址无效: {e}")))?;
    let full = base
        .join(file)
        .map_err(|e| AppError::Invalid(format!("包地址拼接失败: {e}")))?;
    Ok(full.to_string())
}

/* ---- download & verify ---- */

/// 下载到 dest 并边下边校验 SHA-256；on_progress(received, total) 用于进度事件。
fn fetch_to_file(
    url: &str,
    expected_sha256: &str,
    dest: &Path,
    on_progress: &dyn Fn(u64, u64),
) -> AppResult<()> {
    let mut resp = send_get(url).map_err(|e| AppError::Other(format!("下载失败: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Other(format!("下载失败: HTTP {}", resp.status())));
    }
    // 拼错地址时常会拿到 SPA 的 index.html，提前给出明确报错。
    if resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|ct| ct.to_ascii_lowercase().starts_with("text/html"))
    {
        return Err(AppError::Invalid(format!(
            "下载地址返回了网页而不是工具包: {url}"
        )));
    }
    let total = resp.content_length().unwrap_or(0);

    let mut file = fs::File::create(dest)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    let mut received: u64 = 0;
    on_progress(0, total);
    loop {
        let n = resp.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        file.write_all(&buf[..n])?;
        received += n as u64;
        on_progress(received, total);
    }
    drop(file);

    let hex = hex_lower(&hasher.finalize());
    if !hex.eq_ignore_ascii_case(expected_sha256.trim()) {
        let _ = fs::remove_file(dest);
        return Err(AppError::Invalid(format!(
            "SHA-256 校验失败（期望 {}，实际 {}）",
            expected_sha256, hex
        )));
    }
    Ok(())
}

fn download_and_verify(
    app: &AppHandle,
    kind: &str,
    id: &str,
    url: &str,
    expected_sha256: &str,
) -> AppResult<PathBuf> {
    let cache = cache_root(app)?;
    fs::create_dir_all(&cache)?;
    let tmp_path = cache.join(format!("{kind}-{id}.download"));
    let progress = |received: u64, total: u64| {
        emit_progress(app, kind, id, "download", received, total);
    };
    fetch_to_file(url, expected_sha256, &tmp_path, &progress)
        .inspect_err(|_| emit_progress(app, kind, id, "verify", 0, 0))?;
    Ok(tmp_path)
}

/* ---- zip ---- */

/// 解压到 dest。使用 `enclosed_name` 跳过包含 `..` / 绝对路径的条目（防穿越）。
fn extract_zip(zip_path: &Path, dest: &Path) -> AppResult<()> {
    let file = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| AppError::Invalid(format!("zip 打开失败: {e}")))?;
    fs::create_dir_all(dest)?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| AppError::Invalid(format!("zip 读取失败: {e}")))?;
        let Some(rel) = entry.enclosed_name() else {
            continue; // 跳过不安全的路径
        };
        let out = dest.join(rel);
        if entry.is_dir() {
            fs::create_dir_all(&out)?;
        } else {
            if let Some(p) = out.parent() {
                fs::create_dir_all(p)?;
            }
            let mut f = fs::File::create(&out)?;
            std::io::copy(&mut entry, &mut f)?;
        }
    }
    Ok(())
}

/* ---- installed map（tools 与 capabilities 目录布局一致） ---- */

fn read_installed_map(root: &Path) -> serde_json::Map<String, Value> {
    let p = root.join(INSTALLED_FILE);
    if let Ok(text) = fs::read_to_string(&p) {
        if let Ok(Value::Object(map)) = serde_json::from_str(&text) {
            return map;
        }
    }
    serde_json::Map::new()
}

fn write_installed_map(root: &Path, map: &serde_json::Map<String, Value>) -> AppResult<()> {
    let p = root.join(INSTALLED_FILE);
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(&p, serde_json::to_string_pretty(&Value::Object(map.clone()))?)?;
    Ok(())
}

/* ---- install / uninstall ---- */

pub fn install(app: &AppHandle, registry_url: &str, tool_id: &str) -> AppResult<InstalledRecord> {
    let doc = fetch_registry(registry_url)?;
    let record = install_pkg(app, registry_url, &doc, KIND_TOOLS, tool_id)?;
    install_missing_capabilities(app, registry_url, &doc, &record.manifest)?;
    Ok(record)
}

/// 修复：为已安装的工具补齐缺失的依赖能力（能力目录被删/损坏时）。
pub fn repair_capabilities(
    app: &AppHandle,
    registry_url: &str,
    tool_id: &str,
) -> AppResult<Vec<InstalledRecord>> {
    let doc = fetch_registry(registry_url)?;
    let record = list_installed(app)?
        .into_iter()
        .find(|r| r.id == tool_id)
        .ok_or_else(|| AppError::NotFound(format!("未安装工具 {tool_id}")))?;
    install_missing_capabilities(app, registry_url, &doc, &record.manifest)
}

/// 补齐 manifest.requires 中缺失的能力（已安装则跳过，不重复下载）。
fn install_missing_capabilities(
    app: &AppHandle,
    registry_url: &str,
    doc: &RegistryDoc,
    tool_manifest: &Value,
) -> AppResult<Vec<InstalledRecord>> {
    let mut installed = Vec::new();
    if let Some(reqs) = tool_manifest.get("requires").and_then(Value::as_object) {
        for cap_id in reqs.keys() {
            if capability_version(app, cap_id)?.is_some() {
                continue;
            }
            installed.push(install_pkg(app, registry_url, doc, KIND_CAPS, cap_id)?);
        }
    }
    Ok(installed)
}

fn install_pkg(
    app: &AppHandle,
    registry_url: &str,
    doc: &RegistryDoc,
    kind: &str,
    id: &str,
) -> AppResult<InstalledRecord> {
    let list = if kind == KIND_TOOLS {
        &doc.tools
    } else {
        &doc.capabilities
    };
    let pkg = list
        .iter()
        .find(|t| t.manifest.get("id").and_then(Value::as_str) == Some(id))
        .ok_or_else(|| {
            AppError::NotFound(format!("registry 中没有{} {id}", kind_label(kind)))
        })?;

    let pkg_url = resolve_package_url(registry_url, &pkg.package.file)?;
    let zip_path =
        download_and_verify(app, kind, id, &pkg_url, &pkg.package.sha256)?;
    let result = install_from_zip(app, kind, id, &zip_path);
    let _ = fs::remove_file(&zip_path);
    result
}

fn install_from_zip(
    app: &AppHandle,
    kind: &str,
    id: &str,
    zip_path: &Path,
) -> AppResult<InstalledRecord> {
    emit_progress(app, kind, id, "extract", 0, 0);

    let cache = cache_root(app)?;
    fs::create_dir_all(&cache)?;
    let staging = cache.join(format!("{kind}-{id}-stage-{}", uuid::Uuid::new_v4()));

    let inner = || -> AppResult<(PathBuf, Value)> {
        extract_zip(zip_path, &staging)?;
        let manifest_text = fs::read_to_string(staging.join("manifest.json"))
            .map_err(|_| AppError::Invalid("包内缺少 manifest.json".into()))?;
        let manifest: Value = serde_json::from_str(&manifest_text)
            .map_err(|e| AppError::Invalid(format!("manifest 解析失败: {e}")))?;
        let core: ManifestCore = serde_json::from_value(manifest.clone())
            .map_err(|e| AppError::Invalid(format!("manifest 缺少必要字段: {e}")))?;
        if core.id != id {
            return Err(AppError::Invalid(format!(
                "包内 manifest.id（{}）与请求的{}（{id}）不一致",
                core.id,
                kind_label(kind)
            )));
        }
        if !staging.join(&core.entry).is_file() {
            return Err(AppError::Invalid(format!(
                "包内缺少入口文件 {}",
                core.entry
            )));
        }
        let dest = kind_root(app, kind)?.join(&id).join(&core.version);
        if dest.exists() {
            fs::remove_dir_all(&dest)?;
        }
        if let Some(p) = dest.parent() {
            fs::create_dir_all(p)?;
        }
        fs::rename(&staging, &dest)?;
        Ok((dest, manifest))
    };

    let result = inner();
    let _ = fs::remove_dir_all(&staging); // rename 成功后 staging 已不存在，此为兜底
    let (dest, manifest) = result?;

    emit_progress(app, kind, id, "install", 0, 0);

    let root = kind_root(app, kind)?;
    fs::create_dir_all(&root)?;

    // 只保留当前版本，清理旧版本目录。
    let version = manifest
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if let Ok(entries) = fs::read_dir(root.join(id)) {
        for e in entries.flatten() {
            if e.file_name().to_string_lossy() != version && e.path().is_dir() {
                let _ = fs::remove_dir_all(e.path());
            }
        }
    }

    let mut map = read_installed_map(&root);
    map.insert(id.into(), json!(version));
    write_installed_map(&root, &map)?;

    Ok(InstalledRecord {
        id: id.to_string(),
        version,
        root_dir: dest.to_string_lossy().into_owned(),
        manifest,
    })
}

pub fn uninstall(app: &AppHandle, tool_id: &str) -> AppResult<()> {
    let root = plugins_root(app)?;
    fs::create_dir_all(&root)?;
    let mut map = read_installed_map(&root);
    if map.remove(tool_id).is_none() {
        return Err(AppError::NotFound(format!("未安装工具 {tool_id}")));
    }
    let id_dir = root.join(tool_id);
    if id_dir.exists() {
        fs::remove_dir_all(&id_dir)?;
    }
    write_installed_map(&root, &map)?;
    // 引用计数清理：无人再依赖的能力自动卸载。
    cleanup_unreferenced_capabilities(app)
}

/// 当前安装的工具集合所引用的全部能力 ID。
fn referenced_capability_ids(app: &AppHandle) -> AppResult<HashSet<String>> {
    let mut referenced = HashSet::new();
    for rec in list_installed(app)? {
        if let Some(o) = rec.manifest.get("requires").and_then(Value::as_object) {
            referenced.extend(o.keys().cloned());
        }
    }
    Ok(referenced)
}

fn cleanup_unreferenced_capabilities(app: &AppHandle) -> AppResult<()> {
    let referenced = referenced_capability_ids(app)?;
    for rec in list_capabilities(app)? {
        if !referenced.contains(&rec.id) {
            uninstall_capability(app, &rec.id)?;
        }
    }
    Ok(())
}

fn uninstall_capability(app: &AppHandle, cap_id: &str) -> AppResult<()> {
    let root = capabilities_root(app)?;
    fs::create_dir_all(&root)?;
    let mut map = read_installed_map(&root);
    if map.remove(cap_id).is_none() {
        return Err(AppError::NotFound(format!("未安装能力 {cap_id}")));
    }
    let id_dir = root.join(cap_id);
    if id_dir.exists() {
        fs::remove_dir_all(&id_dir)?;
    }
    write_installed_map(&root, &map)
}

fn capability_version(app: &AppHandle, cap_id: &str) -> AppResult<Option<String>> {
    let root = capabilities_root(app)?;
    Ok(read_installed_map(&root)
        .get(cap_id)
        .and_then(Value::as_str)
        .map(str::to_string))
}

/* ---- 列表与文件读取 ---- */

fn list_kind(app: &AppHandle, kind: &str) -> AppResult<Vec<InstalledRecord>> {
    let root = kind_root(app, kind)?;
    let map = read_installed_map(&root);
    let mut out = Vec::new();
    for (id, version_val) in map {
        let Some(version) = version_val.as_str() else {
            continue;
        };
        let dir = root.join(&id).join(version);
        let Ok(text) = fs::read_to_string(dir.join("manifest.json")) else {
            continue; // 记录存在但目录缺失：跳过（可重装修复）
        };
        let Ok(manifest) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        out.push(InstalledRecord {
            id,
            version: version.to_string(),
            root_dir: dir.to_string_lossy().into_owned(),
            manifest,
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

pub fn list_installed(app: &AppHandle) -> AppResult<Vec<InstalledRecord>> {
    list_kind(app, KIND_TOOLS)
}

pub fn list_capabilities(app: &AppHandle) -> AppResult<Vec<InstalledRecord>> {
    list_kind(app, KIND_CAPS)
}

/// 读取已安装包目录内的文本文件（module.js / bridge.js / style.css）。
/// 路径被约束在包根目录内，拒绝穿越。
fn read_kind_file(app: &AppHandle, kind: &str, id: &str, file: &str) -> AppResult<String> {
    let root = kind_root(app, kind)?;
    let map = read_installed_map(&root);
    let version = map
        .get(id)
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::NotFound(format!("未安装{} {id}", kind_label(kind))))?;
    let base = root.join(id).join(version);
    let target = base.join(file);

    let canon_base = base
        .canonicalize()
        .map_err(|e| AppError::NotFound(format!("{}目录不存在: {e}", kind_label(kind))))?;
    let canon_target = target
        .canonicalize()
        .map_err(|_| AppError::NotFound(format!("文件不存在: {file}")))?;
    if !canon_target.starts_with(&canon_base) {
        return Err(AppError::Invalid("非法的插件文件路径".into()));
    }
    fs::read_to_string(&canon_target).map_err(|e| AppError::Other(format!("读取失败: {e}")))
}

pub fn read_plugin_file(app: &AppHandle, tool_id: &str, file: &str) -> AppResult<String> {
    read_kind_file(app, KIND_TOOLS, tool_id, file)
}

pub fn read_capability_file(app: &AppHandle, cap_id: &str, file: &str) -> AppResult<String> {
    read_kind_file(app, KIND_CAPS, cap_id, file)
}

/// 读取能力的 wasm 入口二进制（manifest.entry 指向的文件）。
pub fn read_capability_binary(app: &AppHandle, cap_id: &str) -> AppResult<Vec<u8>> {
    let root = capabilities_root(app)?;
    let map = read_installed_map(&root);
    let version = map
        .get(cap_id)
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::NotFound(format!("未安装能力 {cap_id}")))?;
    let base = root.join(cap_id).join(version);
    let manifest_text = fs::read_to_string(base.join("manifest.json"))
        .map_err(|_| AppError::NotFound("能力 manifest 不存在".into()))?;
    let manifest: Value = serde_json::from_str(&manifest_text)?;
    let entry = manifest
        .get("entry")
        .and_then(Value::as_str)
        .unwrap_or("cap.wasm");
    let path = base.join(entry);

    let canon_base = base
        .canonicalize()
        .map_err(|e| AppError::NotFound(format!("能力目录不存在: {e}")))?;
    let canon_target = path
        .canonicalize()
        .map_err(|_| AppError::NotFound("wasm 入口不存在".into()))?;
    if !canon_target.starts_with(&canon_base) {
        return Err(AppError::Invalid("非法的能力文件路径".into()));
    }
    fs::read(&canon_target).map_err(|e| AppError::Other(format!("读取失败: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// exe 所在目录探测：测试二进制位于 target/debug(deps)，目录应可写。
    #[test]
    fn exe_dir_probe() {
        let dir = exe_dir_if_writable().expect("exe 所在目录应可写");
        let exe_dir = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf();
        assert_eq!(dir, exe_dir);
    }

    /// 用真实构建产物做端到端校验：SHA-256 与 registry 一致、zip 可解压、
    /// manifest/module.js/style.css 完整。运行前先执行 `npm run build:plugins`。
    #[test]
    fn extract_real_plugin_zips() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("public");
        let registry_text = fs::read_to_string(root.join("registry.json"))
            .expect("public/registry.json 不存在（先运行 npm run build:plugins）");
        let registry: Value = serde_json::from_str(&registry_text).unwrap();
        let check = |tools: &Value| {
            for tool in tools.as_array().expect("registry list") {
                let file = tool["package"]["file"].as_str().unwrap();
                let expected = tool["package"]["sha256"].as_str().unwrap();
                let data = fs::read(root.join(file)).unwrap();

                let hex = hex_lower(&Sha256::digest(&data));
                assert_eq!(hex, expected, "{file} SHA-256 与 registry 不一致");

                let tmp = std::env::temp_dir().join(format!(
                    "toolbox-plugin-test-{}",
                    uuid::Uuid::new_v4()
                ));
                fs::create_dir_all(&tmp).unwrap();
                let zip_path = tmp.join("pkg.zip");
                fs::write(&zip_path, &data).unwrap();
                let out = tmp.join("out");
                extract_zip(&zip_path, &out).expect("解压失败");

                let manifest: Value =
                    serde_json::from_str(&fs::read_to_string(out.join("manifest.json")).unwrap())
                        .unwrap();
                let entry = manifest["entry"].as_str().expect("manifest.entry");
                assert!(out.join(entry).is_file(), "{file} 缺少入口 {entry}");
                fs::remove_dir_all(&tmp).ok();
            }
        };
        check(&registry["tools"]);
        check(&registry["capabilities"]);
    }

    /// 远程链路冒烟（需真实网络，显式运行）：
    /// `cargo test remote_registry_smoke -- --ignored --nocapture`
    /// 走与应用完全相同的 send_get（系统代理 → 直连回退）+ 哈希校验路径。
    #[test]
    #[ignore]
    fn remote_registry_smoke() {
        const REGISTRY_URL: &str =
            "https://cdn.jsdelivr.net/gh/pie-tk/toolbox-registry@main/registry.json";

        let doc = fetch_registry(REGISTRY_URL).expect("拉取远程 registry 失败");
        assert!(!doc.tools.is_empty(), "远程 registry 为空");

        let tool = &doc.tools[0];
        let pkg_url = resolve_package_url(REGISTRY_URL, &tool.package.file)
            .expect("拼接包地址失败");
        let tmp = std::env::temp_dir().join(format!(
            "toolbox-remote-smoke-{}",
            uuid::Uuid::new_v4()
        ));
        fetch_to_file(&pkg_url, &tool.package.sha256, &tmp, &|_, _| {})
            .expect("远程下载/校验失败");
        let size = fs::metadata(&tmp).unwrap().len();
        println!(
            "✔ {} v{} 下载 {} bytes，SHA-256 校验通过",
            tool.manifest["id"].as_str().unwrap(),
            tool.manifest["version"].as_str().unwrap(),
            size
        );
        fs::remove_file(&tmp).ok();
    }
}
