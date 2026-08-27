//! 插件协议类型：registry 文档与本地安装记录（跨 IPC，camelCase）。

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryDoc {
    pub schema_version: u32,
    #[serde(default)]
    pub generated_at: String,
    #[serde(default)]
    pub tools: Vec<RegistryTool>,
    /// schemaVersion 2 起支持共享能力（wasm 模块），与工具同构：manifest + package。
    #[serde(default)]
    pub capabilities: Vec<RegistryTool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryTool {
    pub manifest: Value,
    pub package: RegistryPackage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryPackage {
    /// 相对于 registry 地址的包文件名（或绝对 URL）。
    pub file: String,
    pub sha256: String,
    #[serde(default)]
    pub size: u64,
}

/// 已安装插件的记录，返回给前端用于构建工具列表与加载模块。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledRecord {
    pub id: String,
    pub version: String,
    pub root_dir: String,
    pub manifest: Value,
}

/// manifest 中安装器需要校验的少数字段（其余字段原样透传给前端）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestCore {
    pub id: String,
    pub version: String,
    #[serde(default = "default_entry")]
    pub entry: String,
}

fn default_entry() -> String {
    "module.js".into()
}
