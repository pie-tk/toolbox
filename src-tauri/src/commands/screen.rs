//! 屏幕采样原语：全局光标位置 + 光标下像素取色 + 按键状态，以及系统光标替换。
//! 供取色器等插件做屏幕吸管（轮询 screen_sample，点击落色 / Esc·右键取消）。
//! 全部薄封装 OS API：Windows 走 GDI + GetAsyncKeyState + SetSystemCursor；
//! macOS 走 CoreGraphics + NSCursor（手写 FFI，不引额外依赖）。

use crate::error::{AppError, AppResult};
use serde::Serialize;

#[derive(Serialize)]
pub struct ScreenSample {
    pub x: i32,
    pub y: i32,
    pub r: u8,
    pub g: u8,
    pub b: u8,
    /// 像素是否有效（如落在取不到的屏幕区域时 false，插件按"暂停预览"处理）。
    pub valid: bool,
    pub lmb: bool,
    pub rmb: bool,
    pub esc: bool,
}

#[tauri::command]
pub fn screen_sample() -> AppResult<ScreenSample> {
    imp::sample()
}

#[tauri::command]
pub fn screen_cursor_set(
    rgba: Vec<u8>,
    width: i32,
    height: i32,
    hotspot_x: i32,
    hotspot_y: i32,
) -> AppResult<()> {
    if width <= 0 || height <= 0 || rgba.len() != width as usize * height as usize * 4 {
        return Err(AppError::Invalid(
            "光标位图尺寸与 RGBA 数据不一致".into(),
        ));
    }
    imp::set_cursor(&rgba, width, height, hotspot_x, hotspot_y)
}

#[tauri::command]
pub fn screen_cursor_reset() -> AppResult<()> {
    imp::reset_cursor()
}

/// 应用退出前恢复系统光标（取色中途退出防吸管光标残留整个会话）。
pub fn restore_system_cursor() {
    let _ = imp::reset_cursor();
}

#[cfg(all(test, windows))]
mod tests {
    /// GDI 采样链路（GetCursorPos/GetDC/GetPixel）可用且字段在合理范围。
    #[test]
    fn screen_sample_works() {
        let s = super::imp::sample().expect("screen_sample 应成功");
        assert_ne!(s.x, i32::MIN);
        assert_ne!(s.y, i32::MIN);
    }
}

// ---------------------------------------------------------------- Windows

#[cfg(windows)]
mod imp {
    use super::{AppError, AppResult, ScreenSample};
    use std::sync::Mutex;

    use windows_sys::Win32::Foundation::{COLORREF, POINT};
    use windows_sys::Win32::Graphics::Gdi::{
        CreateBitmap, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC,
        GetPixel, ReleaseDC, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON, VK_RBUTTON,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CopyIcon, CreateIconIndirect, GetCursorPos, DestroyIcon, HCURSOR, ICONINFO, LoadCursorW,
        SetSystemCursor, IDC_ARROW, OCR_NORMAL,
    };

    /// 当前光标替换状态：saved_arrow 是原箭头光标的副本（恢复用）。
    /// 吸管光标句柄在 SetSystemCursor 成功后所有权归系统，不再持有。
    struct CursorSwap {
        saved_arrow: HCURSOR,
    }
    unsafe impl Send for CursorSwap {}
    unsafe impl Sync for CursorSwap {}

    static CURSOR: Mutex<Option<CursorSwap>> = Mutex::new(None);

    pub fn sample() -> AppResult<ScreenSample> {
        unsafe {
            let mut pt = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut pt) == 0 {
                return Err(AppError::Other("GetCursorPos 失败".into()));
            }
            let hdc: HDC = GetDC(std::ptr::null_mut());
            if hdc.is_null() {
                return Err(AppError::Other("GetDC(屏幕) 失败".into()));
            }
            // 注意：屏幕 DC 只覆盖主显示器，副屏像素取不到（valid=false，插件暂停预览）。
            let c: COLORREF = GetPixel(hdc, pt.x, pt.y);
            ReleaseDC(std::ptr::null_mut(), hdc);
            let valid = c != 0xFFFF_FFFF; // CLR_INVALID
            let key = |vk: u16| (GetAsyncKeyState(vk as i32) as u16 & 0x8000) != 0;
            Ok(ScreenSample {
                x: pt.x,
                y: pt.y,
                r: (c & 0xFF) as u8,
                g: ((c >> 8) & 0xFF) as u8,
                b: ((c >> 16) & 0xFF) as u8,
                valid,
                lmb: key(VK_LBUTTON),
                rmb: key(VK_RBUTTON),
                esc: key(VK_ESCAPE),
            })
        }
    }

    pub fn set_cursor(rgba: &[u8], w: i32, h: i32, hotspot_x: i32, hotspot_y: i32) -> AppResult<()> {
        let (w, h) = (w as usize, h as usize);
        unsafe {
            // 颜色位图：32bpp 顶层 BGRA DIB（biHeight 取负 = 自顶向下，无需翻转行序）
            let bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w as i32,
                    biHeight: -(h as i32),
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB,
                    biSizeImage: 0,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [std::mem::zeroed()],
            };
            let hdc_mem: HDC = CreateCompatibleDC(std::ptr::null_mut());
            if hdc_mem.is_null() {
                return Err(AppError::Other("CreateCompatibleDC 失败".into()));
            }
            let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
            let hbm_color: HBITMAP = CreateDIBSection(
                hdc_mem,
                &bmi,
                DIB_RGB_COLORS,
                &mut bits,
                std::ptr::null_mut(),
                0,
            );
            DeleteDC(hdc_mem);
            if hbm_color.is_null() || bits.is_null() {
                return Err(AppError::Other("CreateDIBSection 失败".into()));
            }
            // RGBA → BGRA（位图内存布局）
            let bits: *mut u8 = bits.cast();
            for i in 0..w * h {
                let s = i * 4;
                *bits.add(s) = rgba[s + 2];
                *bits.add(s + 1) = rgba[s + 1];
                *bits.add(s + 2) = rgba[s];
                *bits.add(s + 3) = rgba[s + 3];
            }

            // AND 掩码：1bpp 全 0（不透明度交给 32bpp alpha 通道），行按 WORD 对齐
            let and_stride = (w + 15) / 16 * 2;
            let and_bits = vec![0u8; and_stride * h];
            let hbm_mask: HBITMAP =
                CreateBitmap(w as i32, h as i32, 1, 1, and_bits.as_ptr().cast());
            if hbm_mask.is_null() {
                DeleteObject(hbm_color);
                return Err(AppError::Other("CreateBitmap(掩码) 失败".into()));
            }

            let ii = ICONINFO {
                fIcon: 0, // FALSE = 光标（带热点），而非图标
                xHotspot: hotspot_x as u32,
                yHotspot: hotspot_y as u32,
                hbmMask: hbm_mask,
                hbmColor: hbm_color,
            };
            let custom: HCURSOR = CreateIconIndirect(&ii);
            // 位图已被光标复制，立即释放
            DeleteObject(hbm_color);
            DeleteObject(hbm_mask);
            if custom.is_null() {
                return Err(AppError::Other("CreateIconIndirect 失败".into()));
            }
            apply_system_cursor(custom)?;
        }
        Ok(())
    }

    /// 用新光标替换系统箭头（首次替换前保存箭头副本供恢复）。
    fn apply_system_cursor(custom: HCURSOR) -> AppResult<()> {
        let mut guard = CURSOR.lock().map_err(|_| cursor_lock_err())?;
        if guard.is_none() {
            let arrow = unsafe { LoadCursorW(std::ptr::null_mut(), IDC_ARROW) };
            let saved = unsafe { CopyIcon(arrow) };
            if saved.is_null() {
                unsafe { DestroyIcon(custom) };
                return Err(AppError::Other("保存原光标失败".into()));
            }
            *guard = Some(CursorSwap {
                saved_arrow: saved,
            });
        }
        // SetSystemCursor 成功后光标句柄所有权归系统（系统会销毁它），勿再 DestroyIcon。
        if unsafe { SetSystemCursor(custom, OCR_NORMAL) } == 0 {
            unsafe { DestroyIcon(custom) };
            return Err(AppError::Other("SetSystemCursor 失败".into()));
        }
        Ok(())
    }

    pub fn reset_cursor() -> AppResult<()> {
        let swap = CURSOR
            .lock()
            .map_err(|_| cursor_lock_err())?
            .take();
        let Some(s) = swap else {
            return Ok(()); // 未替换过，幂等
        };
        // 恢复箭头副本（句柄同样移交系统）；custom 已归系统，不销毁。
        unsafe { SetSystemCursor(s.saved_arrow, OCR_NORMAL) };
        Ok(())
    }

    fn cursor_lock_err() -> AppError {
        AppError::Other("光标状态锁不可用".into())
    }
}

// ---------------------------------------------------------------- macOS

#[cfg(target_os = "macos")]
mod imp {
    use super::{AppError, AppResult, ScreenSample};
    use std::ffi::{c_char, c_void, CStr, CString};
    use std::sync::Mutex;

    // ---- CoreGraphics（C ABI，坐标均为全局屏幕坐标，原点左上、单位为点） ----

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGSize {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreate(source: *const c_void) -> *const c_void;
        fn CGEventGetLocation(event: *const c_void) -> CGPoint;
        fn CGEventSourceButtonState(state_id: u32, button: u32) -> bool;
        fn CGEventSourceKeyState(state_id: u32, key_code: u16) -> bool;
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
        fn CGWindowListCreateImage(
            bounds: CGRect,
            option: u32,
            window_id: u32,
            image_option: u32,
        ) -> *const c_void;
        fn CGImageGetWidth(image: *const c_void) -> usize;
        fn CGImageGetBytesPerRow(image: *const c_void) -> usize;
        fn CGImageGetBitsPerPixel(image: *const c_void) -> usize;
        fn CGImageGetBitmapInfo(image: *const c_void) -> u32;
        fn CGImageGetDataProvider(image: *const c_void) -> *const c_void;
        fn CGDataProviderCopyData(provider: *const c_void) -> *const c_void;
        fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
        fn CFDataGetLength(data: *const c_void) -> isize;
        fn CFRelease(cf: *const c_void);
    }

    const K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY: u32 = 1;
    const K_CG_NULL_WINDOW_ID: u32 = 0;
    const K_CG_WINDOW_IMAGE_SHOULD_BE_OPAQUE: u32 = 1 << 0;
    const K_CG_WINDOW_IMAGE_BEST_RESOLUTION: u32 = 1 << 5;
    const K_CG_BITMAP_BYTE_ORDER_32_LITTLE: u32 = 2 << 12;
    /// kCGEventSourceStateHIDSystemState：真实键鼠状态
    const K_HID_SOURCE: u32 = 1;
    const K_VK_ESCAPE: u16 = 53;

    // ---- libobjc 消息发送（非变参定型签名，x86_64/arm64 皆走正常寄存器传参） ----

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct ObjCBool(u8); // ObjC BOOL（signed char）：传 0/1 即可
    #[link(name = "objc", kind = "dylib")]
    extern "C" {
        fn objc_getClass(name: *const c_char) -> *mut c_void;
        fn sel_registerName(name: *const c_char) -> *const c_void;
        #[link_name = "objc_msgSend"]
        fn msg_send0(receiver: *mut c_void, sel: *const c_void) -> *mut c_void;
        #[link_name = "objc_msgSend"]
        fn msg_send1(receiver: *mut c_void, sel: *const c_void, a: *mut c_void) -> *mut c_void;
        #[link_name = "objc_msgSend"]
        fn msg_send_size(receiver: *mut c_void, sel: *const c_void, size: CGSize) -> *mut c_void;
        #[link_name = "objc_msgSend"]
        fn msg_send_point(receiver: *mut c_void, sel: *const c_void, point: CGPoint)
        -> *mut c_void;
        #[link_name = "objc_msgSend"]
        fn msg_send_image_point(
            receiver: *mut c_void,
            sel: *const c_void,
            image: *mut c_void,
            point: CGPoint,
        ) -> *mut c_void;
        #[link_name = "objc_msgSend"]
        fn msg_send_bitmap_rep(
            receiver: *mut c_void,
            sel: *const c_void,
            planes: *mut *mut u8,
            pixels_wide: isize,
            pixels_high: isize,
            bits_per_sample: isize,
            samples_per_pixel: isize,
            has_alpha: ObjCBool,
            is_planar: ObjCBool,
            color_space_name: *const c_char,
            bytes_per_row: isize,
            bits_per_pixel: isize,
        ) -> *mut c_void;
    }

    fn cls(name: &CStr) -> *mut c_void {
        // 安全性：AppKit 类名常量，进程内必然注册
        unsafe { objc_getClass(name.as_ptr()) }
    }
    fn sel(name: &CStr) -> *const c_void {
        unsafe { sel_registerName(name.as_ptr()) }
    }

    /// 光标替换状态：objc 对象与位图内存必须存活至恢复（NSBitmapImageRep 不拷贝 planes）。
    struct CursorSwap {
        cursor: *mut c_void,
        /// 依创建顺序持有的 objc 对象（alloc 出来的 rep/image/cursor），恢复时统一 release
        owned: Vec<*mut c_void>,
        /// NSBitmapImageRep 引用的位图内存
        _buf: Vec<u8>,
        /// 颜色空间名常量
        _cs_name: CString,
    }
    unsafe impl Send for CursorSwap {}
    unsafe impl Sync for CursorSwap {}

    static CURSOR: Mutex<Option<CursorSwap>> = Mutex::new(None);

    pub fn sample() -> AppResult<ScreenSample> {
        unsafe {
            // 屏幕录制权限（10.15+）：未授权时 CGWindowListCreateImage 不报错只返回壁纸，
            // 必须显式预检并引导授权，否则取到的是"看似正常的错色"。
            if !CGPreflightScreenCaptureAccess() {
                CGRequestScreenCaptureAccess(); // 触发系统授权引导
                return Err(AppError::Other(
                    "需要「屏幕录制」权限：系统设置 → 隐私与安全性 → 屏幕录制，允许 ToolBox 后重试"
                        .into(),
                ));
            }
            let event = CGEventCreate(std::ptr::null());
            if event.is_null() {
                return Err(AppError::Other("CGEventCreate 失败".into()));
            }
            let pt = CGEventGetLocation(event);
            CFRelease(event);
            Ok(ScreenSample {
                x: pt.x as i32,
                y: pt.y as i32,
                r: 0,
                g: 0,
                b: 0,
                valid: false,
                lmb: CGEventSourceButtonState(K_HID_SOURCE, 0),
                rmb: CGEventSourceButtonState(K_HID_SOURCE, 1),
                esc: CGEventSourceKeyState(K_HID_SOURCE, K_VK_ESCAPE),
            })
            .map(|mut s| {
                if let Some((r, g, b)) = pixel_at(pt.x, pt.y) {
                    s.r = r;
                    s.g = g;
                    s.b = b;
                    s.valid = true;
                }
                s
            })
        }
    }

    /// 取全局坐标 (x, y) 处 1pt 矩形的合成像素（所有在屏窗口叠加结果）。
    fn pixel_at(x: f64, y: f64) -> Option<(u8, u8, u8)> {
        unsafe {
            let rect = CGRect {
                origin: CGPoint { x, y },
                size: CGSize {
                    width: 1.0,
                    height: 1.0,
                },
            };
            let image = CGWindowListCreateImage(
                rect,
                K_CG_WINDOW_LIST_OPTION_ON_SCREEN_ONLY,
                K_CG_NULL_WINDOW_ID,
                K_CG_WINDOW_IMAGE_SHOULD_BE_OPAQUE | K_CG_WINDOW_IMAGE_BEST_RESOLUTION,
            );
            if image.is_null() {
                return None;
            }
            let result = (|| {
                let data = CGDataProviderCopyData(CGImageGetDataProvider(image));
                if data.is_null() {
                    return None;
                }
                let out = (|| {
                    let bpr = CGImageGetBytesPerRow(image);
                    if CGImageGetBitsPerPixel(image) != 32 || bpr < 4 {
                        return None;
                    }
                    let p = CFDataGetBytePtr(data);
                    // Retina 下 1pt 矩形可能返回 2×2 像素，取第一个即可（颜色几乎一致）
                    let (r, g, b) = if CGImageGetBitmapInfo(image)
                        & 0x7000
                        == K_CG_BITMAP_BYTE_ORDER_32_LITTLE
                    {
                        // 小端：内存字节序 B,G,R,A
                        (*p.add(2), *p.add(1), *p)
                    } else {
                        // 大端：R,G,B,A
                        (*p, *p.add(1), *p.add(2))
                    };
                    Some((r, g, b))
                })();
                CFRelease(data);
                out
            })();
            CFRelease(image);
            result
        }
    }

    pub fn set_cursor(rgba: &[u8], w: i32, h: i32, hotspot_x: i32, hotspot_y: i32) -> AppResult<()> {
        unsafe {
            let mut buf = rgba.to_vec();
            let cs_name = CString::new("NSCalibratedRGBColorSpace")
                .map_err(|_| AppError::Invalid("颜色空间名非法".into()))?;

            // NSBitmapImageRep 直接引用 buf 内存（不拷贝），buf 必须存活到恢复
            let mut planes = [buf.as_mut_ptr()];
            let rep = msg_send_bitmap_rep(
                msg_send0(cls(c"NSBitmapImageRep"), sel(c"alloc")),
                sel(c"initWithBitmapDataPlanes:pixelsWide:pixelsHigh:bitsPerSample:samplesPerPixel:hasAlpha:isPlanar:colorSpaceName:bytesPerRow:bitsPerPixel:"),
                planes.as_mut_ptr(),
                w as isize,
                h as isize,
                8,
                4,
                ObjCBool(1),
                ObjCBool(0),
                cs_name.as_ptr(),
                w as isize * 4,
                32,
            );
            if rep.is_null() {
                return Err(AppError::Other("NSBitmapImageRep 创建失败".into()));
            }
            let image = msg_send_size(
                msg_send0(cls(c"NSImage"), sel(c"alloc")),
                sel(c"initWithSize:"),
                CGSize {
                    width: w as f64,
                    height: h as f64,
                },
            );
            if image.is_null() {
                msg_send0(rep, sel(c"release"));
                return Err(AppError::Other("NSImage 创建失败".into()));
            }
            msg_send1(image, sel(c"addRepresentation:"), rep);
            // 位图行 0 在顶部，NSPoint 原点在左下 → 热点 y 需翻转
            let cursor = msg_send_image_point(
                msg_send0(cls(c"NSCursor"), sel(c"alloc")),
                sel(c"initWithImage:hotSpot:"),
                image,
                CGPoint {
                    x: hotspot_x as f64,
                    y: h as f64 - hotspot_y as f64,
                },
            );
            if cursor.is_null() {
                msg_send0(image, sel(c"release"));
                msg_send0(rep, sel(c"release"));
                return Err(AppError::Other("NSCursor 创建失败".into()));
            }
            msg_send0(cursor, sel(c"set"));

            let mut guard = CURSOR.lock().map_err(|_| AppError::Other("光标状态锁不可用".into()))?;
            *guard = Some(CursorSwap {
                cursor,
                owned: vec![rep, image, cursor],
                _buf: buf,
                _cs_name: cs_name,
            });
        }
        Ok(())
    }

    pub fn reset_cursor() -> AppResult<()> {
        let swap = CURSOR.lock().ok().and_then(|mut g| g.take());
        if let Some(s) = swap {
            unsafe {
                let arrow = msg_send0(cls(c"NSCursor"), sel(c"arrowCursor"));
                msg_send0(arrow, sel(c"set"));
                for obj in s.owned {
                    msg_send0(obj, sel(c"release"));
                }
            }
        }
        Ok(())
    }
}

// ---------------------------------------------------------------- 其他平台

#[cfg(not(any(windows, target_os = "macos")))]
mod imp {
    use super::{AppError, AppResult, ScreenSample};

    pub fn sample() -> AppResult<ScreenSample> {
        Err(AppError::Other("当前平台不支持屏幕取色".into()))
    }

    pub fn set_cursor(_rgba: &[u8], _w: i32, _h: i32, _hx: i32, _hy: i32) -> AppResult<()> {
        Err(AppError::Other("当前平台不支持屏幕取色".into()))
    }

    pub fn reset_cursor() -> AppResult<()> {
        Ok(())
    }
}
