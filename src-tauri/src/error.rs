//! Unified error type. Serialized as a plain string across the Tauri IPC boundary
//! (Tauri commands require `E: Serialize`).

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("数据错误: {0}")]
    Json(#[from] serde_json::Error),

    #[error("无效输入: {0}")]
    Invalid(String),

    #[error("找不到: {0}")]
    NotFound(String),

    #[error("{0}")]
    Other(String),
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

pub type AppResult<T> = Result<T, AppError>;
