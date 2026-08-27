//! Thin `#[tauri::command]` wrappers. Commands only adapt IPC types;
//! 重型处理能力由共享能力（wasm）提供，宿主仅保留通用原语（文件/进程）与系统信息。

pub mod host_fs;
pub mod proc;
pub mod system_cmd;
