//! 工具插件分发：registry 拉取、下载安装（SHA-256 校验）、卸载与文件读取。
//! 重 I/O 全部放到阻塞线程池执行。

pub mod service;
pub mod types;

use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use types::{InstalledRecord, RegistryDoc};

/// 拉取远端 registry.json。
#[tauri::command]
pub async fn plugin_fetch_registry(url: String) -> AppResult<RegistryDoc> {
    tauri::async_runtime::spawn_blocking(move || service::fetch_registry(&url))
        .await
        .map_err(|e| AppError::Other(format!("后台任务失败: {e}")))?
}

/// 从 registry 下载并安装/更新工具。进度经 `plugin-install-progress` 事件推送。
#[tauri::command]
pub async fn plugin_install(
    app: AppHandle,
    registry_url: String,
    tool_id: String,
) -> AppResult<InstalledRecord> {
    tauri::async_runtime::spawn_blocking(move || service::install(&app, &registry_url, &tool_id))
        .await
        .map_err(|e| AppError::Other(format!("后台任务失败: {e}")))?
}

/// 修复工具缺失的依赖能力（工具已安装但能力目录丢失时，前端打开门槛触发）。
#[tauri::command]
pub async fn plugin_repair_capabilities(
    app: AppHandle,
    registry_url: String,
    tool_id: String,
) -> AppResult<Vec<InstalledRecord>> {
    tauri::async_runtime::spawn_blocking(move || {
        service::repair_capabilities(&app, &registry_url, &tool_id)
    })
    .await
    .map_err(|e| AppError::Other(format!("后台任务失败: {e}")))?
}

/// 卸载工具（删除插件目录与安装记录）。
#[tauri::command]
pub async fn plugin_uninstall(app: AppHandle, tool_id: String) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || service::uninstall(&app, &tool_id))
        .await
        .map_err(|e| AppError::Other(format!("后台任务失败: {e}")))?
}

/// 列出已安装工具（读取 manifest）。
#[tauri::command]
pub fn plugin_list_installed(app: AppHandle) -> AppResult<Vec<InstalledRecord>> {
    service::list_installed(&app)
}

/// 列出已安装的共享能力（wasm 模块）。
#[tauri::command]
pub fn capability_list_installed(app: AppHandle) -> AppResult<Vec<InstalledRecord>> {
    service::list_capabilities(&app)
}

/// 读取已安装插件内的文本文件（module.js / style.css），路径约束在插件根目录内。
#[tauri::command]
pub fn plugin_read_file(app: AppHandle, tool_id: String, file: String) -> AppResult<String> {
    service::read_plugin_file(&app, &tool_id, &file)
}

/// 读取已安装能力内的文本文件（bridge.js）。wasm 是二进制，走专用命令。
#[tauri::command]
pub fn capability_read_file(app: AppHandle, cap_id: String, file: String) -> AppResult<String> {
    service::read_capability_file(&app, &cap_id, &file)
}

/// 读取能力的 wasm 二进制（走原始 IPC 通道，避免 JSON 数组序列化开销）。
#[tauri::command]
pub fn capability_read_wasm(app: AppHandle, cap_id: String) -> AppResult<tauri::ipc::Response> {
    let bytes = service::read_capability_binary(&app, &cap_id)?;
    Ok(tauri::ipc::Response::new(bytes))
}
