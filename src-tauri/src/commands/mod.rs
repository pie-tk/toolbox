//! Thin `#[tauri::command]` wrappers. Commands only adapt IPC types;
//! 重型处理能力由共享能力（wasm）提供，宿主仅保留通用文件原语与系统信息。

pub mod host_fs;
pub mod system_cmd;
