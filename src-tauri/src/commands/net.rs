//! 通用网络原语：为插件提供局域网通信能力（入站 WS/HTTP 服务器、UDP 收发、网卡枚举）。
//! 宿主只做传输层转发，协议编解码与业务逻辑全部在插件（TS）侧完成。
//! 信任模型与 fs/proc 原语一致：第一版插件均由 registry 发布方控制。
//!
//! 事件（广播给前端，插件按 id 过滤）：
//!   net-ws-open     { id, connId, kind: "ws"|"http", remote, path?, query?, headers? }
//!   net-ws-message  { id, connId, kind, data }   — WS=文本帧原文；HTTP=JSON 串 {method,path,query,body}
//!   net-ws-close    { id, connId }
//!   net-udp-message { id, from, dataB64 }        — base64（mDNS 等报文含非 UTF-8 字节）

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::error::{AppError, AppResult};

/// 请求头（含请求行）上限；超过直接断开。
const MAX_HEAD: usize = 64 * 1024;
/// HTTP 请求体上限（壁纸等 base64 上传会比较大）。
const MAX_BODY: usize = 32 * 1024 * 1024;
/// 等待完整请求头的超时。
const HEAD_TIMEOUT: Duration = Duration::from_secs(10);
/// HTTP 请求等待插件应答的超时（插件分发层的处理窗口）。
const RESP_TIMEOUT: Duration = Duration::from_secs(30);

/* ---- IPC 类型 ---- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsServerInfo {
    pub running: bool,
    pub port: u16,
    pub connections: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UdpInfo {
    pub running: bool,
    pub port: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetIf {
    pub name: String,
    pub ip: String,
    pub family: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UdpOptions {
    pub bind_port: u16,
    /// 组播组地址（如 239.255.255.252 / 224.0.0.251），加入成员并设置组播参数。
    pub multicast_group: Option<String>,
    /// 组播出口网卡 IP；缺省用系统默认路由。
    pub interface: Option<String>,
    /// 是否允许端口复用（mDNS 5353 需要多个进程共存）。
    pub reuse: Option<bool>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WsOpenEvent {
    id: String,
    conn_id: u64,
    kind: &'static str,
    remote: String,
    path: Option<String>,
    query: Option<String>,
    headers: Option<HashMap<String, String>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WsMessageEvent {
    id: String,
    conn_id: u64,
    kind: &'static str,
    data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WsCloseEvent {
    id: String,
    conn_id: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UdpMessageEvent {
    id: String,
    from: String,
    data_b64: String,
}

/* ---- 内部状态 ---- */

#[derive(Clone, Copy, PartialEq)]
enum ConnKind {
    Ws,
    Http,
}

impl ConnKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Ws => "ws",
            Self::Http => "http",
        }
    }
}

struct ConnEntry {
    tx: mpsc::Sender<String>,
}

struct ServerEntry {
    port: u16,
    conns: Arc<Mutex<HashMap<u64, ConnEntry>>>,
    /// accept 循环句柄；stop 时 abort（监听随任务结束释放端口）。
    task: tauri::async_runtime::JoinHandle<()>,
}

struct UdpEntry {
    sock: Arc<tokio::net::UdpSocket>,
    task: tauri::async_runtime::JoinHandle<()>,
}

#[derive(Default)]
pub struct NetState {
    servers: Mutex<HashMap<String, ServerEntry>>,
    udps: Mutex<HashMap<String, UdpEntry>>,
}

fn lock<T>(m: &Mutex<T>) -> AppResult<std::sync::MutexGuard<'_, T>> {
    m.lock().map_err(|_| AppError::Other("网络服务表锁定失败".into()))
}

fn check_id(id: &str) -> AppResult<()> {
    if id.is_empty() || id.contains(['/', '\\']) || id.contains("..") {
        return Err(AppError::Invalid("非法的网络服务 id".into()));
    }
    Ok(())
}

/* ---- HTTP 最小解析与应答 ---- */

struct ReqHead {
    method: String,
    path: String,
    query: String,
    headers: HashMap<String, String>,
    /// 头部长度（不含结尾 CRLFCRLF），用于计算完整请求字节数。
    head_len: usize,
}

fn find_head_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn parse_head(buf: &[u8]) -> Option<ReqHead> {
    let text = std::str::from_utf8(buf).ok()?;
    let mut lines = text.split("\r\n");
    let request_line = lines.next()?;
    let mut parts = request_line.split(' ');
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (target, String::new()),
    };
    let mut headers: HashMap<String, Vec<String>> = HashMap::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers
                .entry(k.trim().to_ascii_lowercase())
                .or_default()
                .push(v.trim().to_string());
        }
    }
    let headers = headers
        .into_iter()
        .map(|(k, v)| (k, v.join(", ")))
        .collect();
    Some(ReqHead { method, path, query, headers, head_len: buf.len() })
}

fn http_response(status: &str, content_type: &str, body: &[u8]) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 {status}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    out.extend_from_slice(body);
    out
}

fn http_no_content() -> Vec<u8> {
    b"HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Max-Age: 86400\r\nConnection: close\r\n\r\n".to_vec()
}

/// peek 直到读齐完整请求头（不消费字节，WebSocket 升级仍可交给 tungstenite 自行握手）。
async fn peek_head(stream: &TcpStream) -> AppResult<Option<ReqHead>> {
    let mut window = vec![0u8; MAX_HEAD];
    let deadline = tokio::time::Instant::now() + HEAD_TIMEOUT;
    loop {
        let n = stream
            .peek(&mut window)
            .await
            .map_err(|e| AppError::Other(format!("读取请求头失败: {e}")))?;
        if n == 0 {
            return Ok(None); // 对端在发完头之前关闭
        }
        if let Some(pos) = find_head_end(&window[..n]) {
            return parse_head(&window[..pos])
                .map(Some)
                .ok_or_else(|| AppError::Invalid("无法解析的 HTTP 请求头".into()));
        }
        if n >= window.len() {
            return Err(AppError::Invalid("请求头超过 64KB 上限".into()));
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(AppError::Other("等待请求头超时".into()));
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

/* ---- 连接处理 ---- */

async fn handle_conn(
    app: AppHandle,
    id: String,
    conn_id: u64,
    conns: Arc<Mutex<HashMap<u64, ConnEntry>>>,
    mut stream: TcpStream,
    remote: SocketAddr,
) {
    let head = match peek_head(&stream).await {
        Ok(Some(h)) => h,
        Ok(None) => return,
        Err(e) => {
            let _ = stream
                .write_all(&http_response("400 Bad Request", "text/plain", e.to_string().as_bytes()))
                .await;
            return;
        }
    };

    // CORS 预检由宿主直接应答，不打扰插件。
    if head.method == "OPTIONS" {
        let _ = stream.write_all(&http_no_content()).await;
        return;
    }

    let is_ws = head.method == "GET"
        && head
            .headers
            .get("upgrade")
            .map(|v| v.to_ascii_lowercase().contains("websocket"))
            .unwrap_or(false)
        && head.headers.contains_key("sec-websocket-key");

    if is_ws {
        // tungstenite 自行完成握手（peek 未消费字节，可完整重读请求）。
        match tokio::time::timeout(HEAD_TIMEOUT, tokio_tungstenite::accept_async(stream)).await {
            Ok(Ok(ws)) => handle_ws_conn(app, id, conn_id, conns, ws, remote, head).await,
            _ => {}
        }
    } else {
        handle_http_conn(app, id, conn_id, conns, stream, remote, head).await;
    }
}

async fn handle_ws_conn(
    app: AppHandle,
    id: String,
    conn_id: u64,
    conns: Arc<Mutex<HashMap<u64, ConnEntry>>>,
    ws: tokio_tungstenite::WebSocketStream<TcpStream>,
    remote: SocketAddr,
    head: ReqHead,
) {
    let (mut sink, mut read) = ws.split();
    let (tx, mut rx) = mpsc::channel::<String>(32);
    if let Ok(mut map) = lock(&conns) {
        map.insert(conn_id, ConnEntry { tx });
    } else {
        return;
    }
    let _ = app.emit(
        "net-ws-open",
        WsOpenEvent {
            id: id.clone(),
            conn_id,
            kind: ConnKind::Ws.as_str(),
            remote: remote.to_string(),
            path: Some(head.path),
            query: Some(head.query),
            headers: None,
        },
    );

    loop {
        tokio::select! {
            msg = read.next() => match msg {
                Some(Ok(Message::Text(t))) => {
                    let _ = app.emit(
                        "net-ws-message",
                        WsMessageEvent {
                            id: id.clone(),
                            conn_id,
                            kind: ConnKind::Ws.as_str(),
                            data: t.to_string(),
                        },
                    );
                }
                // ping/pong 由 tungstenite 协议层自动处理；二进制帧忽略。
                Some(Ok(_)) => {}
                Some(Err(_)) | None => break,
            },
            out = rx.recv() => match out {
                Some(text) => {
                    if sink.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                None => break,
            },
        }
    }

    if let Ok(mut map) = lock(&conns) {
        map.remove(&conn_id);
    }
    let _ = app.emit("net-ws-close", WsCloseEvent { id, conn_id });
}

async fn handle_http_conn(
    app: AppHandle,
    id: String,
    conn_id: u64,
    conns: Arc<Mutex<HashMap<u64, ConnEntry>>>,
    mut stream: TcpStream,
    remote: SocketAddr,
    head: ReqHead,
) {
    if head
        .headers
        .get("transfer-encoding")
        .map(|v| v.to_ascii_lowercase().contains("chunked"))
        .unwrap_or(false)
    {
        let _ = stream
            .write_all(&http_response("411 Length Required", "text/plain", b"chunked not supported"))
            .await;
        return;
    }
    let content_len: usize = head
        .headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if content_len > MAX_BODY {
        let _ = stream
            .write_all(&http_response("413 Payload Too Large", "text/plain", b"body too large"))
            .await;
        return;
    }

    // peek 未消费字节，这里按已知总长整体读入（头 + CRLFCRLF + body）。
    let total = head.head_len + 4 + content_len;
    let mut buf = vec![0u8; total];
    if stream.read_exact(&mut buf).await.is_err() {
        return;
    }
    let body = String::from_utf8_lossy(&buf[head.head_len + 4..]).into_owned();

    let (tx, mut rx) = mpsc::channel::<String>(1);
    if let Ok(mut map) = lock(&conns) {
        map.insert(conn_id, ConnEntry { tx });
    } else {
        return;
    }

    let data = serde_json::json!({
        "method": head.method,
        "path": head.path,
        "query": head.query,
        "body": body,
    })
    .to_string();
    let _ = app.emit(
        "net-ws-open",
        WsOpenEvent {
            id: id.clone(),
            conn_id,
            kind: ConnKind::Http.as_str(),
            remote: remote.to_string(),
            path: Some(head.path),
            query: Some(head.query),
            headers: Some(head.headers),
        },
    );
    let _ = app.emit(
        "net-ws-message",
        WsMessageEvent { id: id.clone(), conn_id, kind: ConnKind::Http.as_str(), data },
    );

    // 插件经 net_ws_send 送回应答体，宿主包装成完整 HTTP 响应并关闭连接。
    let resp = match tokio::time::timeout(RESP_TIMEOUT, rx.recv()).await {
        Ok(Some(text)) => http_response("200 OK", "application/json", text.as_bytes()),
        _ => http_response(
            "504 Gateway Timeout",
            "application/json",
            br#"{"success":false,"error":"response timeout"}"#,
        ),
    };
    let _ = stream.write_all(&resp).await;
    let _ = stream.shutdown().await;

    if let Ok(mut map) = lock(&conns) {
        map.remove(&conn_id);
    }
    // 关闭事件对 HTTP 意义不大，但保持生命周期对称。
    let _ = app.emit("net-ws-close", WsCloseEvent { id, conn_id });
}

/* ---- WS/HTTP 服务器命令 ---- */

/// 启动入站服务器（同 id 已在运行则报错）。端口占用直接报错；
/// 端口自增（≤100 次）等策略由前端实现，原语保持零逻辑。
#[tauri::command]
pub async fn net_ws_server_start(
    app: AppHandle,
    state: State<'_, NetState>,
    id: String,
    port: u16,
) -> AppResult<WsServerInfo> {
    check_id(&id)?;
    if lock(&state.servers)?.contains_key(&id) {
        return Err(AppError::Invalid(format!("网络服务 {id} 已在运行")));
    }

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|e| AppError::Other(format!("端口 {port} 绑定失败: {e}")))?;
    let real_port = listener
        .local_addr()
        .map_err(|e| AppError::Other(format!("获取端口失败: {e}")))?
        .port();

    let conns: Arc<Mutex<HashMap<u64, ConnEntry>>> = Arc::new(Mutex::new(HashMap::new()));
    let next_id = Arc::new(AtomicU64::new(1));
    let conns_entry = conns.clone();
    let app_loop = app.clone();
    let id_loop = id.clone();
    let task = tauri::async_runtime::spawn(async move {
        loop {
            let (stream, remote) = match listener.accept().await {
                Ok(x) => x,
                Err(_) => {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
            };
            let _ = stream.set_nodelay(true);
            let conn_id = next_id.fetch_add(1, Ordering::Relaxed);
            let conns_conn = conns.clone();
            let app_conn = app_loop.clone();
            let id_conn = id_loop.clone();
            tauri::async_runtime::spawn(async move {
                handle_conn(app_conn, id_conn, conn_id, conns_conn, stream, remote).await;
            });
        }
    });

    // bind 期间锁被释放，插入前复查，避免并发同 id 双启。
    let mut servers = lock(&state.servers)?;
    if servers.contains_key(&id) {
        task.abort();
        return Err(AppError::Invalid(format!("网络服务 {id} 已在运行")));
    }
    servers.insert(id, ServerEntry { port: real_port, conns: conns_entry, task });
    Ok(WsServerInfo { running: true, port: real_port, connections: 0 })
}

/// 停止服务器（幂等：id 不存在也返回成功）。
#[tauri::command]
pub fn net_ws_server_stop(state: State<NetState>, id: String) -> AppResult<()> {
    let Some(entry) = lock(&state.servers)?.remove(&id) else {
        return Ok(());
    };
    entry.task.abort();
    if let Ok(mut conns) = lock(&entry.conns) {
        for (_, conn) in conns.drain() {
            // 丢弃 tx 即让连接任务自然退出，无需持有任务句柄。
            drop(conn);
        }
    }
    Ok(())
}

/// 查询状态（插件重新挂载后凭 id 收养仍在运行的服务器）。
#[tauri::command]
pub fn net_ws_server_status(state: State<NetState>, id: String) -> AppResult<WsServerInfo> {
    let servers = lock(&state.servers)?;
    let Some(entry) = servers.get(&id) else {
        return Ok(WsServerInfo { running: false, port: 0, connections: 0 });
    };
    let connections = lock(&entry.conns).map(|c| c.len()).unwrap_or(0);
    Ok(WsServerInfo { running: true, port: entry.port, connections })
}

/// 向连接发送数据：WS 连接发文本帧；HTTP 连接作为应答体（宿主包装响应并关闭）。
#[tauri::command]
pub async fn net_ws_send(
    state: State<'_, NetState>,
    id: String,
    conn_id: u64,
    text: String,
) -> AppResult<()> {
    let tx = {
        let servers = lock(&state.servers)?;
        let entry = servers
            .get(&id)
            .ok_or_else(|| AppError::NotFound(format!("网络服务 {id} 未在运行")))?;
        let conns = lock(&entry.conns)?;
        conns
            .get(&conn_id)
            .map(|c| c.tx.clone())
            .ok_or_else(|| AppError::NotFound(format!("连接 {conn_id} 已不存在")))?
    };
    tx.send(text)
        .await
        .map_err(|_| AppError::Other("连接已关闭".into()))
}

/// 主动关闭单个连接（业务层拒绝非法路径等场景）。
#[tauri::command]
pub fn net_ws_close_conn(state: State<NetState>, id: String, conn_id: u64) -> AppResult<()> {
    let servers = lock(&state.servers)?;
    let entry = servers
        .get(&id)
        .ok_or_else(|| AppError::NotFound(format!("网络服务 {id} 未在运行")))?;
    let mut conns = lock(&entry.conns)?;
    conns
        .remove(&conn_id)
        .ok_or_else(|| AppError::NotFound(format!("连接 {conn_id} 已不存在")))?;
    Ok(())
}

/* ---- UDP 命令 ---- */

/// 启动 UDP 收发（可选加入组播组）。报文经 net-udp-message 事件转发给插件。
#[tauri::command]
pub async fn net_udp_start(
    app: AppHandle,
    state: State<'_, NetState>,
    id: String,
    opts: UdpOptions,
) -> AppResult<UdpInfo> {
    check_id(&id)?;
    if lock(&state.udps)?.contains_key(&id) {
        return Err(AppError::Invalid(format!("UDP 服务 {id} 已在运行")));
    }

    let sock = socket2::Socket::new(
        socket2::Domain::IPV4,
        socket2::Type::DGRAM,
        Some(socket2::Protocol::UDP),
    )
    .map_err(|e| AppError::Other(format!("创建 UDP socket 失败: {e}")))?;
    if opts.reuse.unwrap_or(false) {
        sock.set_reuse_address(true)
            .map_err(|e| AppError::Other(format!("设置端口复用失败: {e}")))?;
    }
    sock.bind(&socket2::SockAddr::from(SocketAddr::from(([0, 0, 0, 0], opts.bind_port))))
        .map_err(|e| AppError::Other(format!("UDP 端口 {} 绑定失败: {e}", opts.bind_port)))?;
    if let Some(group) = &opts.multicast_group {
        let group_ip: std::net::Ipv4Addr = group
            .parse()
            .map_err(|_| AppError::Invalid(format!("无效的组播组地址: {group}")))?;
        let iface_ip: std::net::Ipv4Addr = opts
            .interface
            .as_deref()
            .map(str::parse)
            .transpose()
            .map_err(|_| AppError::Invalid("无效的网卡地址".into()))?
            .unwrap_or(std::net::Ipv4Addr::UNSPECIFIED);
        if iface_ip.is_unspecified() {
            sock.join_multicast_v4(&group_ip, &std::net::Ipv4Addr::UNSPECIFIED)
        } else {
            sock.set_multicast_if_v4(&iface_ip).ok();
            sock.join_multicast_v4(&group_ip, &iface_ip)
        }
        .map_err(|e| AppError::Other(format!("加入组播组失败: {e}")))?;
        let _ = sock.set_multicast_loop_v4(true);
        let _ = sock.set_multicast_ttl_v4(255);
    }
    sock.set_nonblocking(true)
        .map_err(|e| AppError::Other(format!("设置非阻塞失败: {e}")))?;
    let std_sock: std::net::UdpSocket = sock.into();
    let real_port = std_sock
        .local_addr()
        .map_err(|e| AppError::Other(format!("获取端口失败: {e}")))?
        .port();
    let tokio_sock = tokio::net::UdpSocket::from_std(std_sock)
        .map_err(|e| AppError::Other(format!("转入异步运行时失败: {e}")))?;

    let sock = Arc::new(tokio_sock);
    let recv_sock = sock.clone();
    let app_loop = app.clone();
    let id_loop = id.clone();
    let task = tauri::async_runtime::spawn(async move {
        let mut buf = vec![0u8; 65_536];
        loop {
            match recv_sock.recv_from(&mut buf).await {
                Ok((n, from)) => {
                    let _ = app_loop.emit(
                        "net-udp-message",
                        UdpMessageEvent {
                            id: id_loop.clone(),
                            from: from.to_string(),
                            data_b64: B64.encode(&buf[..n]),
                        },
                    );
                }
                Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
            }
        }
    });

    lock(&state.udps)?.insert(id, UdpEntry { sock, task });
    Ok(UdpInfo { running: true, port: real_port })
}

/// 经同一 socket 发送（保证源端口与组成员身份，组播/单播兜底都依赖此语义）。
#[tauri::command]
pub async fn net_udp_send(
    state: State<'_, NetState>,
    id: String,
    host: String,
    port: u16,
    data_b64: String,
) -> AppResult<()> {
    let sock = {
        let udps = lock(&state.udps)?;
        udps.get(&id)
            .map(|e| e.sock.clone())
            .ok_or_else(|| AppError::NotFound(format!("UDP 服务 {id} 未在运行")))?
    };
    let bytes = B64
        .decode(data_b64.as_bytes())
        .map_err(|e| AppError::Invalid(format!("base64 解码失败: {e}")))?;
    let ip: IpAddr = host
        .parse()
        .map_err(|_| AppError::Invalid(format!("无效的目标地址: {host}")))?;
    sock.send_to(&bytes, SocketAddr::new(ip, port))
        .await
        .map_err(|e| AppError::Other(format!("UDP 发送失败: {e}")))?;
    Ok(())
}

/// 停止 UDP 收发（幂等）。
#[tauri::command]
pub fn net_udp_stop(state: State<NetState>, id: String) -> AppResult<()> {
    let Some(entry) = lock(&state.udps)?.remove(&id) else {
        return Ok(());
    };
    entry.task.abort();
    Ok(())
}

/// 枚举本机网卡（环境配置区的网卡选择）。
#[tauri::command]
pub fn net_local_ips() -> AppResult<Vec<NetIf>> {
    let list = if_addrs::get_if_addrs().map_err(|e| AppError::Other(format!("枚举网卡失败: {e}")))?;
    Ok(list
        .into_iter()
        .map(|i| {
            let ip = i.ip();
            NetIf {
                name: i.name,
                ip: ip.to_string(),
                family: if matches!(ip, IpAddr::V4(_)) { "v4" } else { "v6" },
            }
        })
        .collect())
}

/* ---- 单元测试 ---- */

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn head_end_detection() {
        let raw = b"GET / HTTP/1.1\r\nHost: x\r\n\r\nbody";
        let head_only = &raw[..raw.len() - 4 - "body".len()];
        assert_eq!(find_head_end(raw), Some(head_only.len()));
        assert_eq!(find_head_end(b"no terminator"), None);
    }

    #[test]
    fn parse_request_head() {
        let raw = b"POST /api/config/ak_gateway/create?k=v&x=1 HTTP/1.1\r\nHost: localhost\r\nContent-Length: 7";
        let head = parse_head(raw).expect("parse");
        assert_eq!(head.method, "POST");
        assert_eq!(head.path, "/api/config/ak_gateway/create");
        assert_eq!(head.query, "k=v&x=1");
        assert_eq!(head.headers.get("content-length").map(String::as_str), Some("7"));
        assert_eq!(head.head_len, raw.len());
    }

    #[test]
    fn http_response_layout() {
        let body = br#"{"ok":true}"#;
        let resp = http_response("200 OK", "application/json", body);
        let text = String::from_utf8(resp).unwrap();
        assert!(text.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(text.contains("Access-Control-Allow-Origin: *\r\n"));
        assert!(text.contains(&format!("Content-Length: {}\r\n", body.len())));
        assert!(text.ends_with("\r\n\r\n{\"ok\":true}"));
    }

    #[test]
    fn multi_value_headers_joined() {
        let head = parse_head(b"GET /x HTTP/1.1\r\nX-A: 1\r\nX-A: 2\r\n\r\n").unwrap();
        assert_eq!(head.headers.get("x-a").map(String::as_str), Some("1, 2"));
    }
}
