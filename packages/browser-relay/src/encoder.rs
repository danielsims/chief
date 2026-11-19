//! H.264 through the vendored x264, tuned for low-latency screen streaming. The
//! settings live in `x264_shim.c`.

use std::ffi::c_void;

extern "C" {
    fn relay_x264_open(
        width: i32,
        height: i32,
        fps: i32,
        threads: i32,
        crf: f32,
        max_kbps: i32,
        buffer_kbit: i32,
    ) -> *mut c_void;
    fn relay_x264_rate(encoder: *mut c_void, crf: f32, max_kbps: i32, buffer_kbit: i32) -> i32;
    #[allow(clippy::too_many_arguments)]
    fn relay_x264_encode(
        encoder: *mut c_void,
        y: *const u8,
        u: *const u8,
        v: *const u8,
        stride_y: i32,
        stride_uv: i32,
        pts: i64,
        force_idr: i32,
        mb_info: *mut u8,
        out: *mut *const u8,
        keyframe: *mut i32,
    ) -> i32;
    fn relay_x264_close(encoder: *mut c_void);
}

pub struct EncoderConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub threads: u32,
    pub crf: f32,
    /// VBV cap in kbit/s.
    pub max_kbps: u32,
}

pub struct Encoder {
    handle: *mut c_void,
    fps: u32,
    pts: i64,
}

// Used from one thread at a time.
unsafe impl Send for Encoder {}

pub struct Planes<'a> {
    pub y: &'a [u8],
    pub u: &'a [u8],
    pub v: &'a [u8],
    pub stride_y: usize,
    pub stride_uv: usize,
}

impl Encoder {
    pub fn new(cfg: &EncoderConfig) -> Result<Self, String> {
        let handle = unsafe {
            relay_x264_open(
                cfg.width as i32,
                cfg.height as i32,
                cfg.fps as i32,
                cfg.threads.max(1) as i32,
                cfg.crf,
                cfg.max_kbps as i32,
                vbv_buffer_kbit(cfg.max_kbps, cfg.fps) as i32,
            )
        };
        if handle.is_null() {
            return Err("x264 rejected the encoder settings".into());
        }
        Ok(Encoder { handle, fps: cfg.fps, pts: 0 })
    }

    /// Changes quality and the bitrate cap on the fly.
    pub fn set_rate(&mut self, crf: f32, max_kbps: u32) {
        self.set_rate_buf(crf, max_kbps, vbv_buffer_kbit(max_kbps, self.fps));
    }

    /// Like `set_rate` with an explicit VBV buffer, so one frame (a keyframe)
    /// can spend more than a frame's share.
    pub fn set_rate_buf(&mut self, crf: f32, max_kbps: u32, buffer_kbit: u32) {
        unsafe { relay_x264_rate(self.handle, crf, max_kbps as i32, buffer_kbit as i32) };
    }

    /// Encodes one picture, appending Annex-B output to `out`. `mb_info` marks
    /// unchanged macroblocks (1) so x264 skips them; returns whether it's a keyframe.
    pub fn encode(
        &mut self,
        planes: &Planes,
        ts_ms: i64,
        force_idr: bool,
        mb_info: Option<&mut [u8]>,
        out: &mut Vec<u8>,
    ) -> Result<bool, String> {
        self.pts = ts_ms.max(self.pts + 1);
        let mut data: *const u8 = std::ptr::null();
        let mut keyframe = 0;
        let size = unsafe {
            relay_x264_encode(
                self.handle,
                planes.y.as_ptr(),
                planes.u.as_ptr(),
                planes.v.as_ptr(),
                planes.stride_y as i32,
                planes.stride_uv as i32,
                self.pts,
                i32::from(force_idr),
                mb_info.map_or(std::ptr::null_mut(), |m| m.as_mut_ptr()),
                &mut data,
                &mut keyframe,
            )
        };
        if size < 0 {
            return Err("x264 failed to encode a frame".into());
        }
        if size > 0 && !data.is_null() {
            out.extend_from_slice(unsafe { std::slice::from_raw_parts(data, size as usize) });
        }
        Ok(keyframe != 0)
    }
}

/// About 1.25 frames of buffer: single-frame spikes stay bounded.
fn vbv_buffer_kbit(max_kbps: u32, fps: u32) -> u32 {
    (max_kbps * 5).div_ceil(4 * fps.max(1))
}

impl Drop for Encoder {
    fn drop(&mut self) {
        unsafe { relay_x264_close(self.handle) }
    }
}
