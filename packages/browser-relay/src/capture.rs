//! X11 capture of one session's virtual display, driven by XDamage.
//! Adapted from voxl (MIT); see NOTICE.
//!
//! The session's Xvfb runs with `-shmem` inside the session's private IPC
//! namespace, so its framebuffer segment is reachable only from that session:
//! it's read in place, with no copy. Without it, frames come over MIT-SHM into a
//! segment only this process can open.

use std::os::fd::{AsFd, BorrowedFd};
use x11rb::connection::{Connection, RequestConnection};
use x11rb::protocol::damage::{self, ConnectionExt as _};
use x11rb::protocol::shm::{self, ConnectionExt as _};
use x11rb::protocol::xfixes::ConnectionExt as _;
use x11rb::protocol::xproto::{ConnectionExt as _, ImageFormat};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;

struct ShmBuf {
    ptr: *mut u8,
    len: usize,
    shmid: i32,
    /// Xvfb's own segment: detached, never removed, by us.
    foreign: bool,
}

unsafe impl Send for ShmBuf {}

impl ShmBuf {
    fn new(len: usize) -> Result<Self, String> {
        unsafe {
            let shmid = libc::shmget(libc::IPC_PRIVATE, len, libc::IPC_CREAT | 0o600);
            if shmid < 0 {
                return Err("shmget failed".into());
            }
            let ptr = libc::shmat(shmid, std::ptr::null(), 0);
            if ptr as isize == -1 {
                libc::shmctl(shmid, libc::IPC_RMID, std::ptr::null_mut());
                return Err("shmat failed".into());
            }
            Ok(ShmBuf {
                ptr: ptr as *mut u8,
                len,
                shmid,
                foreign: false,
            })
        }
    }

    fn attach_readonly(shmid: i32, len: usize) -> Option<Self> {
        unsafe {
            let ptr = libc::shmat(shmid, std::ptr::null(), libc::SHM_RDONLY);
            (ptr as isize != -1).then_some(ShmBuf {
                ptr: ptr as *mut u8,
                len,
                shmid,
                foreign: true,
            })
        }
    }

    fn as_slice(&self) -> &[u8] {
        unsafe { std::slice::from_raw_parts(self.ptr, self.len) }
    }
}

impl Drop for ShmBuf {
    fn drop(&mut self) {
        unsafe {
            libc::shmdt(self.ptr as *const _);
            if !self.foreign {
                libc::shmctl(self.shmid, libc::IPC_RMID, std::ptr::null_mut());
            }
        }
    }
}

/// Rows [y0, y1) of the screen, even-aligned for 4:2:0.
#[derive(Clone, Copy, Debug)]
pub struct Band {
    pub y0: u32,
    pub y1: u32,
}

pub struct Capturer {
    conn: RustConnection,
    root: u32,
    pub width: u32,
    pub height: u32,
    stride: usize,
    seg: u32,
    buf: ShmBuf,
    /// Where pixels start in `buf` (past the XWD header of Xvfb's framebuffer).
    offset: usize,
    /// Reading Xvfb's framebuffer in place.
    direct: bool,
    _damage: u32,
    pub damaged: bool,
    pub damaged_at: Option<std::time::Instant>,
    rows: Option<(u32, u32)>,
    /// 16x16 macroblocks touched since the last take, row-major.
    mb_dirty: Vec<u8>,
}

impl Capturer {
    /// Connects to `display`. `xvfb_pid` is the session's own X server, the only
    /// process whose framebuffer segment may be read.
    pub fn new(display: &str, xvfb_pid: Option<u32>) -> Result<Self, String> {
        let (conn, screen) = RustConnection::connect(Some(display)).map_err(|e| format!("X connect: {e}"))?;
        let root = conn.setup().roots[screen].root;
        let depth = conn.setup().roots[screen].root_depth;
        if depth != 24 && depth != 32 {
            return Err(format!("unsupported root depth {depth}"));
        }
        let geometry = conn
            .get_geometry(root)
            .map_err(|e| e.to_string())?
            .reply()
            .map_err(|e| e.to_string())?;
        let (width, height) = (u32::from(geometry.width), u32::from(geometry.height));
        conn.extension_information(shm::X11_EXTENSION_NAME)
            .map_err(|e| e.to_string())?
            .ok_or("no MIT-SHM")?;
        conn.shm_query_version().map_err(|e| e.to_string())?.reply().map_err(|e| e.to_string())?;
        conn.damage_query_version(1, 1).map_err(|e| e.to_string())?.reply().map_err(|e| e.to_string())?;
        conn.xfixes_query_version(5, 0).map_err(|e| e.to_string())?.reply().map_err(|e| e.to_string())?;
        let seg = conn.generate_id().map_err(|e| e.to_string())?;
        let mut stride = width as usize * 4;
        let (buf, offset, direct) = match xvfb_pid.and_then(|pid| xvfb_framebuffer(&conn, root, width, height, pid)) {
            Some((buf, offset, fb_stride)) => {
                stride = fb_stride;
                (buf, offset, true)
            }
            None => {
                let buf = ShmBuf::new(stride * height as usize)?;
                conn.shm_attach(seg, buf.shmid as u32, false)
                    .map_err(|e| e.to_string())?
                    .check()
                    .map_err(|e| e.to_string())?;
                // Removed once both sides detach; nothing else can attach meanwhile.
                unsafe { libc::shmctl(buf.shmid, libc::IPC_RMID, std::ptr::null_mut()) };
                (buf, 0, false)
            }
        };
        let damage = conn.generate_id().map_err(|e| e.to_string())?;
        conn.damage_create(damage, root, damage::ReportLevel::RAW_RECTANGLES)
            .map_err(|e| e.to_string())?;
        conn.flush().map_err(|e| e.to_string())?;
        Ok(Capturer {
            conn,
            root,
            width,
            height,
            stride,
            seg,
            buf,
            offset,
            direct,
            _damage: damage,
            damaged: true,
            damaged_at: None,
            rows: None,
            mb_dirty: vec![0; (width as usize).div_ceil(16) * (height as usize).div_ceil(16)],
        })
    }

    pub fn fd(&self) -> BorrowedFd<'_> {
        self.conn.stream().as_fd()
    }

    pub fn full(&self) -> Band {
        Band { y0: 0, y1: self.height }
    }

    /// Drains queued damage events into the pending band and macroblock map.
    pub fn pump(&mut self) -> Result<(), String> {
        let columns = (self.width as usize).div_ceil(16);
        while let Some(event) = self.conn.poll_for_event().map_err(|e| e.to_string())? {
            let Event::DamageNotify(e) = event else { continue };
            let top = (e.area.y as i32).clamp(0, self.height as i32) as u32;
            let bottom = (e.area.y as i32 + e.area.height as i32).clamp(0, self.height as i32) as u32;
            let left = (e.area.x as i32).clamp(0, self.width as i32) as u32;
            let right = (e.area.x as i32 + e.area.width as i32).clamp(0, self.width as i32) as u32;
            if bottom <= top || right <= left {
                continue;
            }
            let (x0, x1) = (left as usize / 16, (right as usize).div_ceil(16));
            for row in (top as usize / 16)..(bottom as usize).div_ceil(16) {
                self.mb_dirty[row * columns + x0..row * columns + x1].fill(1);
            }
            self.rows = Some(match self.rows {
                Some((a, b)) => (a.min(top), b.max(bottom)),
                None => (top, bottom),
            });
            self.damaged = true;
            self.damaged_at.get_or_insert_with(std::time::Instant::now);
        }
        Ok(())
    }

    /// Takes the accumulated damage as an even-aligned band.
    pub fn take_damage(&mut self) -> Option<Band> {
        self.damaged = false;
        self.damaged_at = None;
        self.rows.take().map(|(y0, y1)| Band {
            y0: y0 & !1,
            y1: ((y1 + 1) & !1).min(self.height),
        })
    }

    /// Takes the changed-macroblock map: 1 for changed, 0 for unchanged.
    pub fn take_mb_map(&mut self) -> Vec<u8> {
        let n = self.mb_dirty.len();
        std::mem::replace(&mut self.mb_dirty, vec![0; n])
    }

    /// Brings `band` of the screen into the capture buffer.
    pub fn grab(&self, band: Band) -> Result<(), String> {
        let rows = band.y1.saturating_sub(band.y0);
        if rows == 0 || self.direct {
            return Ok(());
        }
        self.conn
            .shm_get_image(
                self.root,
                0,
                band.y0 as i16,
                self.width as u16,
                rows as u16,
                !0,
                ImageFormat::Z_PIXMAP.into(),
                self.seg,
                (band.y0 as usize * self.stride) as u32,
            )
            .map_err(|e| e.to_string())?
            .reply()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn convert(&self, dst: &mut crate::convert::I420, band: Band, threads: usize) {
        crate::convert::convert_band(self.pixels(), self.stride, dst, band.y0 as usize, band.y1 as usize, threads);
    }

    fn pixels(&self) -> &[u8] {
        &self.buf.as_slice()[self.offset..self.offset + self.stride * self.height as usize]
    }
}

fn be32(b: &[u8], i: usize) -> u32 {
    u32::from_be_bytes([b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]])
}

/// Xvfb with `-shmem` keeps its screen as an XWD image in a SysV segment. Only a
/// segment created by `xvfb_pid` is considered, and its pixels are checked
/// against the server before it's trusted.
fn xvfb_framebuffer(
    conn: &RustConnection,
    root: u32,
    width: u32,
    height: u32,
    xvfb_pid: u32,
) -> Option<(ShmBuf, usize, usize)> {
    let table = std::fs::read_to_string("/proc/sysvipc/shm").ok()?;
    for line in table.lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        let (Some(shmid), Some(size), Some(creator)) = (
            fields.get(1).and_then(|f| f.parse::<i32>().ok()),
            fields.get(3).and_then(|f| f.parse::<usize>().ok()),
            fields.get(4).and_then(|f| f.parse::<u32>().ok()),
        ) else {
            continue;
        };
        if creator != xvfb_pid || size < (width * height * 4) as usize {
            continue;
        }
        let Some(buf) = ShmBuf::attach_readonly(shmid, size) else { continue };
        let b = buf.as_slice();
        if b.len() < 80 {
            continue;
        }
        let header = be32(b, 0) as usize;
        let (w, h, bpp, bpl, colors) = (be32(b, 4), be32(b, 5), be32(b, 11), be32(b, 12) as usize, be32(b, 19) as usize);
        if be32(b, 1) != 7 || w < width || h < height || bpp != 32 || bpl < (w * 4) as usize {
            continue;
        }
        let offset = header + colors * 12;
        if offset + bpl * h as usize > size {
            continue;
        }
        // Compare a strip of real pixels with what the server reports.
        let (strip_y, strip_h) = (height / 2, 16u32.min(height / 2).max(1));
        for _ in 0..10 {
            let Ok(Ok(image)) = conn
                .get_image(ImageFormat::Z_PIXMAP, root, 0, strip_y as i16, width as u16, strip_h as u16, !0)
                .map(|cookie| cookie.reply())
            else {
                break;
            };
            let row = width as usize * 4;
            let mut same = 0usize;
            for r in 0..strip_h as usize {
                let framebuffer = &b[offset + (strip_y as usize + r) * bpl..][..row];
                let reported = &image.data[r * row..][..row];
                same += framebuffer
                    .chunks_exact(4)
                    .zip(reported.chunks_exact(4))
                    .filter(|(a, c)| a[..3] == c[..3])
                    .count();
            }
            if same * 100 >= (width * strip_h) as usize * 98 {
                return Some((buf, offset, bpl));
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
    }
    None
}
