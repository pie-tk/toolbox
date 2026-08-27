//! 宿主通用文件原语：为插件（如 Mipmap Studio）提供受控的文件访问。
//! 第一版信任模型：插件由 registry 发布方控制（SHA-256 校验），原语不做
//! 逐插件路径授权；后续可按工具声明权限再收紧。
//!
//! 图像处理等重能力不在此层 —— 由共享能力（wasm，见 plugin 模块）提供，
//! 宿主只保留薄壳，避免体积随工具增长。

use serde::Serialize;
use tauri::ipc::Response;

use crate::error::{AppError, AppResult};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// mtime in seconds since UNIX_EPOCH.
    pub modified: u64,
}

/// 列出一层目录（含子目录与文件，带元数据）。
#[tauri::command]
pub fn fs_list_dir(dir: String) -> AppResult<Vec<FsEntry>> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let Ok(entry) = entry else { continue };
        let Ok(meta) = entry.metadata() else { continue };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        out.push(FsEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            size: meta.len(),
            modified,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// 读取文件二进制（原始 IPC 通道，供 wasm 能力消费）。
#[tauri::command]
pub fn fs_read_bytes(path: String) -> AppResult<Response> {
    let bytes = std::fs::read(&path).map_err(|e| AppError::Other(format!("读取失败: {e}")))?;
    Ok(Response::new(bytes))
}

/// 写入文件二进制。
#[tauri::command]
pub fn fs_write_bytes(path: String, data: Vec<u8>) -> AppResult<()> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, data)?;
    Ok(())
}

/// `std::fs::rename`，跨卷时回退为 copy+remove。
#[tauri::command]
pub fn fs_rename(from: String, to: String) -> AppResult<()> {
    if let Err(e) = std::fs::rename(&from, &to) {
        let cross = matches!(e.kind(), std::io::ErrorKind::CrossesDevices)
            || e.raw_os_error() == Some(17)
            || e.raw_os_error() == Some(18);
        if cross {
            std::fs::copy(&from, &to)?;
            std::fs::remove_file(&from)?;
        } else {
            return Err(e.into());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn fs_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
pub fn fs_remove_file(path: String) -> AppResult<()> {
    std::fs::remove_file(&path)?;
    Ok(())
}

/// 仅能删除空目录（与 std::fs::remove_dir 语义一致，用于撤销时清理）。
#[tauri::command]
pub fn fs_remove_dir(path: String) -> AppResult<()> {
    std::fs::remove_dir(&path)?;
    Ok(())
}

#[tauri::command]
pub fn fs_create_dir_all(path: String) -> AppResult<()> {
    std::fs::create_dir_all(&path)?;
    Ok(())
}

/// 宿主缓存目录（插件可在此放操作暂存，如删除回收站）。
#[tauri::command]
pub fn fs_cache_dir(app: tauri::AppHandle) -> AppResult<String> {
    let base = tauri::Manager::path(&app)
        .app_local_data_dir()
        .map_err(|e| AppError::Other(format!("无法定位数据目录: {e}")))?;
    let cache = base.join("cache");
    std::fs::create_dir_all(&cache)?;
    Ok(cache.to_string_lossy().into_owned())
}
