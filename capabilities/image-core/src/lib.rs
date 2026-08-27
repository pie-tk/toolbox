//! image-core WASM 能力：图片探测 / 缩略图 / 格式转换。
//!
//! 与宿主 JS 桥的极简 C ABI：
//! - `tb_alloc` / `tb_free`：输入数据的 wasm 内存分配
//! - `tb_ret_ptr` / `tb_ret_len`：返回值（成功为数据，失败为错误信息）
//! - `tb_probe` / `tb_thumbnail` / `tb_convert`：业务函数，0 成功 / -1 失败
//!
//! 返回区用静态可变存储：wasm32 单线程执行，桥在每次调用后立即拷贝走数据。

use std::alloc::{alloc, dealloc, Layout};
use std::io::Cursor;

static mut RET_PTR: usize = 0;
static mut RET_LEN: usize = 0;

fn set_ret(bytes: &[u8]) {
    unsafe {
        RET_PTR = bytes.as_ptr() as usize;
        RET_LEN = bytes.len();
    }
}

fn finish(result: Result<Vec<u8>, String>) -> i32 {
    match result {
        Ok(bytes) => {
            set_ret(&bytes);
            0
        }
        Err(e) => {
            set_ret(e.as_bytes());
            -1
        }
    }
}

#[no_mangle]
pub extern "C" fn tb_alloc(size: usize) -> *mut u8 {
    unsafe { alloc(Layout::from_size_align(size.max(1), 1).unwrap()) }
}

#[no_mangle]
pub extern "C" fn tb_free(ptr: *mut u8, size: usize) {
    unsafe { dealloc(ptr, Layout::from_size_align(size.max(1), 1).unwrap()) }
}

#[no_mangle]
pub extern "C" fn tb_ret_ptr() -> usize {
    unsafe { RET_PTR }
}

#[no_mangle]
pub extern "C" fn tb_ret_len() -> usize {
    unsafe { RET_LEN }
}

fn input<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    unsafe { std::slice::from_raw_parts(ptr, len) }
}

/// 探测图片：返回 JSON {"width":N,"height":N,"format":"Png"}
#[no_mangle]
pub extern "C" fn tb_probe(ptr: *const u8, len: usize) -> i32 {
    let data = input(ptr, len);
    let run = || -> Result<Vec<u8>, String> {
        let format = image::guess_format(data).map_err(|e| format!("无法识别图片格式: {e}"))?;
        let reader = image::ImageReader::new(Cursor::new(data))
            .with_guessed_format()
            .map_err(|e| format!("读取失败: {e}"))?;
        let (w, h) = reader
            .into_dimensions()
            .map_err(|e| format!("解析尺寸失败: {e}"))?;
        Ok(format!("{{\"width\":{w},\"height\":{h},\"format\":\"{format:?}\"}}").into_bytes())
    };
    finish(run())
}

/// 缩略图：等比缩放到 max_w × max_h 内，输出 PNG。
#[no_mangle]
pub extern "C" fn tb_thumbnail(ptr: *const u8, len: usize, max_w: u32, max_h: u32) -> i32 {
    let data = input(ptr, len);
    let run = || -> Result<Vec<u8>, String> {
        let img =
            image::load_from_memory(data).map_err(|e| format!("解码失败: {e}"))?;
        let thumb = img.thumbnail(max_w.max(1), max_h.max(1));
        let mut out = Vec::new();
        thumb
            .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
            .map_err(|e| format!("编码失败: {e}"))?;
        Ok(out)
    };
    finish(run())
}

/// 水平镜像：解码 → fliph → 按原格式重新编码（用于 RTL 资源生成）。
#[no_mangle]
pub extern "C" fn tb_flip(ptr: *const u8, len: usize) -> i32 {
    let data = input(ptr, len);
    let run = || -> Result<Vec<u8>, String> {
        let img =
            image::load_from_memory(data).map_err(|e| format!("解码失败: {e}"))?;
        let flipped = img.fliph();
        let format =
            image::guess_format(data).map_err(|e| format!("无法识别图片格式: {e}"))?;
        let mut out = Vec::new();
        flipped
            .write_to(&mut Cursor::new(&mut out), format)
            .map_err(|e| format!("编码失败: {e}"))?;
        Ok(out)
    };
    finish(run())
}

/// 格式转换：fmt 0=PNG 1=JPEG 2=WebP(无损)；quality 仅 JPEG (1-100)；
/// max_dim > 0 时先等比缩放到该尺寸内。
#[no_mangle]
pub extern "C" fn tb_convert(
    ptr: *const u8,
    len: usize,
    fmt: u32,
    quality: u32,
    max_dim: u32,
) -> i32 {
    let data = input(ptr, len);
    let run = || -> Result<Vec<u8>, String> {
        let mut img =
            image::load_from_memory(data).map_err(|e| format!("解码失败: {e}"))?;
        if max_dim > 0 {
            img = img.thumbnail(max_dim, max_dim);
        }
        let mut out = Vec::new();
        match fmt {
            0 => img
                .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
                .map_err(|e| format!("PNG 编码失败: {e}"))?,
            1 => {
                use image::codecs::jpeg::JpegEncoder;
                use image::ExtendedColorType;
                use image::ImageEncoder;
                let q = quality.clamp(1, 100) as u8;
                let rgb = img.to_rgb8();
                let (w, h) = rgb.dimensions();
                JpegEncoder::new_with_quality(&mut out, q)
                    .write_image(rgb.as_raw(), w, h, ExtendedColorType::Rgb8)
                    .map_err(|e| format!("JPEG 编码失败: {e}"))?;
            }
            2 => {
                use image::codecs::webp::WebPEncoder;
                use image::ExtendedColorType;
                use image::ImageEncoder;
                let rgba = img.to_rgba8();
                let (w, h) = rgba.dimensions();
                WebPEncoder::new_lossless(&mut out)
                    .write_image(rgba.as_raw(), w, h, ExtendedColorType::Rgba8)
                    .map_err(|e| format!("WebP 编码失败: {e}"))?;
            }
            _ => return Err(format!("未知格式代码 {fmt}")),
        }
        Ok(out)
    };
    finish(run())
}
