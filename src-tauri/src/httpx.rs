//! 出站 HTTP 共享助手：插件分发（plugin/service.rs 的 registry 拉取/下载）与
//! 插件通用网络原语（commands/net.rs 的 net_http_request）共用。

use std::sync::OnceLock;
use std::time::Duration;

use crate::error::{AppError, AppResult};

/// 两套 HTTP 客户端：优先走系统代理（部分网络必须代理才能访问 GitHub），
/// 连接失败时回退直连（部分代理规则会拦截 CDN 域名）。
fn clients() -> &'static (reqwest::blocking::Client, reqwest::blocking::Client) {
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

/// 带回退的请求（系统代理 → 直连）：由 `build` 在两套客户端上分别构造请求，
/// 返回首个收到响应的结果；全失败时错误信息包含两轮完整错误链。
/// 单请求覆盖超时可用 RequestBuilder::timeout（会覆盖客户端默认 30s）。
pub(crate) fn send_with_fallback(
    build: impl Fn(&reqwest::blocking::Client) -> reqwest::blocking::RequestBuilder,
) -> AppResult<reqwest::blocking::Response> {
    let (proxied, direct) = clients();
    let mut errors: Vec<String> = Vec::new();
    for (label, client) in [("系统代理", proxied), ("直连", direct)] {
        match build(client).send() {
            Ok(resp) => return Ok(resp),
            Err(e) => errors.push(format!("{label}: {}", error_chain(&e))),
        }
    }
    Err(AppError::Other(format!(
        "网络请求失败（已尝试 {}）",
        errors.join("；")
    )))
}
