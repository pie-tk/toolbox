//! Tauri 2 wiring：宿主保持薄壳 —— 窗口/导航/插件分发（下载、校验、安装）
//! 与通用原语（文件/进程）。工具 UI 与业务逻辑全部在插件中，图像处理等
//! 重能力由共享能力（wasm，如 image-core）在 WebView 内提供，宿主体积不随工具增长。

mod commands;
mod error;
mod plugin;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

/// 托盘「显示主界面」/ 左键点击托盘：显示并聚焦主窗口。
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(commands::proc::ProcState::default());
            app.manage(commands::net::NetState::default());

            // 系统托盘：左键点击显示主界面，右键菜单提供 显示/退出。
            // 窗口关闭按钮的行为（询问/最小化/退出）由前端按设置处理，
            // 最小化即隐藏窗口，应用驻留托盘。
            let show = MenuItem::with_id(app, "tray-show", "显示主界面", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "tray-quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("main-tray")
                .icon(
                    app.default_window_icon()
                        .expect("缺少应用图标")
                        .clone(),
                )
                .tooltip("ToolBox")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray-show" => show_main_window(app),
                    "tray-quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system_cmd::app_info,
            commands::host_fs::fs_list_dir,
            commands::host_fs::fs_read_bytes,
            commands::host_fs::fs_write_bytes,
            commands::host_fs::fs_rename,
            commands::host_fs::fs_exists,
            commands::host_fs::fs_remove_file,
            commands::host_fs::fs_remove_dir,
            commands::host_fs::fs_create_dir_all,
            commands::host_fs::fs_cache_dir,
            commands::proc::proc_start,
            commands::proc::proc_stop,
            commands::proc::proc_status,
            commands::proc::proc_read_log,
            commands::proc::proc_run_once,
            commands::net::net_ws_server_start,
            commands::net::net_ws_server_stop,
            commands::net::net_ws_server_status,
            commands::net::net_ws_send,
            commands::net::net_ws_close_conn,
            commands::net::net_udp_start,
            commands::net::net_udp_send,
            commands::net::net_udp_stop,
            commands::net::net_local_ips,
            plugin::plugin_fetch_registry,
            plugin::plugin_install,
            plugin::plugin_repair_capabilities,
            plugin::plugin_uninstall,
            plugin::plugin_list_installed,
            plugin::plugin_read_file,
            plugin::capability_list_installed,
            plugin::capability_read_file,
            plugin::capability_read_wasm,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
