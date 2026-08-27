//! 受控进程原语：为「启动器型」插件（如智能家居模拟器）提供进程管理。
//! 输出重定向到日志文件（cache/proc-logs/<id>.log）；停止走 taskkill 树杀。
//! 信任模型与 fs 原语一致：第一版插件均由 registry 发布方控制。

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcInfo {
    pub running: bool,
    pub pid: Option<u32>,
    pub started_at: Option<u64>,
}

impl ProcInfo {
    fn idle() -> Self {
        Self { running: false, pid: None, started_at: None }
    }
}

struct Tracked {
    child: Child,
    started_at: u64,
}

#[derive(Default)]
pub struct ProcState {
    procs: Mutex<HashMap<String, Tracked>>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn log_path_for(app: &AppHandle, id: &str) -> AppResult<PathBuf> {
    // id 只作文件名，拒绝路径分隔
    if id.contains(['/', '\\']) || id.contains("..") {
        return Err(AppError::Invalid("非法的进程 id".into()));
    }
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AppError::Other(format!("无法定位数据目录: {e}")))?;
    let dir = base.join("cache").join("proc-logs");
    fs::create_dir_all(&dir)?;
    Ok(dir.join(format!("{id}.log")))
}

fn no_window(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW：不弹控制台，GUI 窗口不受影响
    }
    cmd
}

/// 启动被跟踪的进程（同 id 已在运行则报错）。stdout/stderr 写入日志文件。
#[tauri::command]
pub fn proc_start(
    app: AppHandle,
    state: State<ProcState>,
    id: String,
    exe: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> AppResult<ProcInfo> {
    let mut procs = state
        .procs
        .lock()
        .map_err(|_| AppError::Other("进程表锁定失败".into()))?;
    if let Some(t) = procs.get_mut(&id) {
        if t.child.try_wait().ok().flatten().is_none() {
            return Err(AppError::Invalid(format!("进程 {id} 已在运行")));
        }
    }

    let log_path = log_path_for(&app, &id)?;
    let stdout = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)?;
    let stderr = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)?;

    let mut cmd = Command::new(&exe);
    cmd.args(&args)
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .stdin(Stdio::null());
    if let Some(dir) = &cwd {
        cmd.current_dir(dir);
    }
    let child = no_window(&mut cmd)
        .spawn()
        .map_err(|e| AppError::Other(format!("启动失败: {e}（检查路径: {exe}）")))?;

    let started_at = now_secs();
    let info = ProcInfo {
        running: true,
        pid: Some(child.id()),
        started_at: Some(started_at),
    };
    procs.insert(id, Tracked { child, started_at });
    Ok(info)
}

/// 停止进程（taskkill /T 树杀，覆盖派生的子进程）。
#[tauri::command]
pub fn proc_stop(state: State<ProcState>, id: String) -> AppResult<()> {
    let mut procs = state
        .procs
        .lock()
        .map_err(|_| AppError::Other("进程表锁定失败".into()))?;
    let Some(mut t) = procs.remove(&id) else {
        return Err(AppError::NotFound(format!("进程 {id} 未在运行")));
    };
    let pid = t.child.id();
    drop(procs);
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status();
    let _ = t.child.wait(); // 回收
    Ok(())
}

/// 查询进程状态（已退出则回收条目）。
#[tauri::command]
pub fn proc_status(state: State<ProcState>, id: String) -> AppResult<ProcInfo> {
    let mut procs = state
        .procs
        .lock()
        .map_err(|_| AppError::Other("进程表锁定失败".into()))?;
    let Some(t) = procs.get_mut(&id) else {
        return Ok(ProcInfo::idle());
    };
    match t.child.try_wait() {
        Ok(Some(_)) => {
            procs.remove(&id);
            Ok(ProcInfo::idle())
        }
        Ok(None) => Ok(ProcInfo {
            running: true,
            pid: Some(t.child.id()),
            started_at: Some(t.started_at),
        }),
        Err(_) => Ok(ProcInfo::idle()),
    }
}

/// 读取进程日志尾部 N 行（进程退出后日志仍可读）。
#[tauri::command]
pub fn proc_read_log(app: AppHandle, id: String, tail: usize) -> AppResult<Vec<String>> {
    let path = log_path_for(&app, &id)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path)?;
    // 处理可能的 \r\n 与丢包半行
    let lines: Vec<String> = text
        .lines()
        .map(|l| l.trim_end_matches('\r').to_string())
        .collect();
    let start = lines.len().saturating_sub(tail.max(1));
    Ok(lines[start..].to_vec())
}

/// 一次性命令（不跟踪、不记日志），用于「打开目录」等轻量动作。
#[tauri::command]
pub fn proc_run_once(exe: String, args: Vec<String>, cwd: Option<String>) -> AppResult<()> {
    let mut cmd = Command::new(&exe);
    cmd.args(&args).stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null());
    if let Some(dir) = &cwd {
        cmd.current_dir(dir);
    }
    no_window(&mut cmd)
        .spawn()
        .map_err(|e| AppError::Other(format!("执行失败: {e}")))?;
    Ok(())
}
