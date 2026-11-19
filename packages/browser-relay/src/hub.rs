//! Viewers and the shared state the video and audio threads read.

use bytes::Bytes;
use std::collections::VecDeque;
use std::os::fd::{AsFd, BorrowedFd, FromRawFd, OwnedFd};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

/// A message for one viewer.
pub enum Out {
    Binary(Bytes),
    Text(String),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    /// Steers frame pacing and bitrate.
    Control,
    /// Follows along; skips to the next keyframe when it falls behind.
    Watch,
}

struct Inflight {
    id: u32,
    sent: Instant,
    bytes: usize,
}

/// Send-to-ack delay: `base` is a slowly expiring minimum (path plus decode),
/// the excess over it is queueing.
struct Delay {
    base_ms: f64,
    base_at: Instant,
    queue_ms: f64,
}

struct Delivered {
    window_start: Instant,
    bytes: usize,
    rate_kbps: f64,
}

pub(crate) struct Client {
    pub id: u64,
    pub role: Role,
    tx: mpsc::UnboundedSender<Out>,
    /// The viewer is showing video (its card is on screen).
    pub video: AtomicBool,
    pub audio: AtomicBool,
    /// Wants a keyframe before it can decode anything.
    pub needs_keyframe: AtomicBool,
    /// Has a keyframe since video last (re)started.
    pub started: AtomicBool,
    inflight: Mutex<VecDeque<Inflight>>,
    delay: Mutex<Delay>,
    delivered: Mutex<Delivered>,
}

/// A viewer more than this far behind has stalled (hidden, dead socket).
const STALLED_MS: u128 = 4000;
/// A viewer this many frames behind is dropped.
const HOPELESS_FRAMES: usize = 600;

impl Client {
    pub fn send(&self, m: Out) {
        let _ = self.tx.send(m);
    }

    pub fn on_ack(&self, id: u32) {
        let mut queue = self.inflight.lock().unwrap();
        let (mut acked, mut sample) = (0, None);
        while let Some(f) = queue.front() {
            if !wrapping_le(f.id, id) {
                break;
            }
            acked += f.bytes;
            if f.id == id {
                sample = Some(f.sent.elapsed().as_secs_f64() * 1000.0);
            }
            queue.pop_front();
        }
        drop(queue);
        if let Some(ms) = sample {
            let mut d = self.delay.lock().unwrap();
            if ms < d.base_ms || d.base_at.elapsed() >= Duration::from_secs(10) {
                d.base_ms = ms;
                d.base_at = Instant::now();
            }
            d.queue_ms = d.queue_ms * 0.7 + (ms - d.base_ms) * 0.3;
        }
        let mut r = self.delivered.lock().unwrap();
        r.bytes += acked;
        let elapsed = r.window_start.elapsed().as_secs_f64();
        if elapsed >= 0.5 {
            let kbps = r.bytes as f64 * 8.0 / elapsed / 1000.0;
            r.rate_kbps = if r.rate_kbps == 0.0 { kbps } else { r.rate_kbps * 0.6 + kbps * 0.4 };
            r.bytes = 0;
            r.window_start = Instant::now();
        }
    }

    /// Frames in flight and the age of the oldest.
    pub fn backlog(&self) -> (usize, u128) {
        let q = self.inflight.lock().unwrap();
        (q.len(), q.front().map_or(0, |f| f.sent.elapsed().as_millis()))
    }

    /// Round trip including decode, from acks (40 ms until measured).
    pub fn rtt_ms(&self) -> f64 {
        match self.delay.lock().unwrap().base_ms {
            ms if ms.is_finite() => ms.max(1.0),
            _ => 40.0,
        }
    }

    pub fn queue_ms(&self) -> f64 {
        self.delay.lock().unwrap().queue_ms
    }

    pub fn delivered_kbps(&self) -> f64 {
        self.delivered.lock().unwrap().rate_kbps
    }

    /// Whether this viewer has too much in flight to take another frame.
    pub fn lagging(&self, interval_ms: f64) -> bool {
        let (n, age) = self.backlog();
        if n == 0 {
            return false;
        }
        let rtt = self.rtt_ms();
        // Enough frames to cover a round trip plus decode, never more than ~rtt+120 ms queued.
        let max_n = (((rtt + 40.0) / interval_ms).ceil() as usize + 2).clamp(3, 40);
        n >= max_n || age > rtt as u128 + 120
    }

    /// Clears a stalled viewer's backlog so it can resync from a keyframe.
    pub fn drop_if_stalled(&self) -> bool {
        let (n, age) = self.backlog();
        if n > 0 && age > STALLED_MS {
            self.inflight.lock().unwrap().clear();
            self.started.store(false, Ordering::Relaxed);
            return true;
        }
        false
    }

    /// Restarts video: everything in flight is forgotten and a keyframe is due.
    pub fn restart(&self) {
        self.inflight.lock().unwrap().clear();
        self.started.store(false, Ordering::Relaxed);
        self.needs_keyframe.store(true, Ordering::Relaxed);
    }

    /// Queues one encoded frame; false if the viewer is hopelessly behind.
    pub fn push_frame(&self, id: u32, parts: &[Bytes], bytes: usize) -> bool {
        let mut q = self.inflight.lock().unwrap();
        if q.len() > HOPELESS_FRAMES {
            return false;
        }
        q.push_back(Inflight { id, sent: Instant::now(), bytes });
        drop(q);
        for part in parts {
            self.send(Out::Binary(part.clone()));
        }
        true
    }
}

fn wrapping_le(a: u32, b: u32) -> bool {
    b.wrapping_sub(a) < 0x8000_0000
}

/// Wakes the capture thread, which blocks in `poll` on its X connection and this.
pub(crate) struct Wake(OwnedFd);

impl Wake {
    fn new() -> Self {
        let fd = unsafe { libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC) };
        assert!(fd >= 0, "eventfd failed");
        Wake(unsafe { OwnedFd::from_raw_fd(fd) })
    }

    pub fn signal(&self) {
        let one: u64 = 1;
        unsafe { libc::write(self.fd_raw(), (&one as *const u64).cast(), 8) };
    }

    pub fn drain(&self) {
        let mut n: u64 = 0;
        unsafe { libc::read(self.fd_raw(), (&mut n as *mut u64).cast(), 8) };
    }

    pub fn fd(&self) -> BorrowedFd<'_> {
        self.0.as_fd()
    }

    fn fd_raw(&self) -> i32 {
        use std::os::fd::AsRawFd;
        self.0.as_raw_fd()
    }
}

/// Blocks until one of `fds` is readable, or `timeout_ms` passes (-1: forever).
pub(crate) fn wait_any(fds: &[BorrowedFd], timeout_ms: i32) {
    use std::os::fd::AsRawFd;
    let mut polls: Vec<libc::pollfd> = fds
        .iter()
        .map(|fd| libc::pollfd { fd: fd.as_raw_fd(), events: libc::POLLIN, revents: 0 })
        .collect();
    unsafe { libc::poll(polls.as_mut_ptr(), polls.len() as libc::nfds_t, timeout_ms) };
}

pub(crate) struct Hub {
    pub clients: Mutex<Vec<Arc<Client>>>,
    next_id: AtomicU64,
    pub width: u32,
    pub height: u32,
    pub audio_enabled: bool,
    pub wake: Wake,
    /// Signalled when a viewer turns sound on or off, joins or leaves, and on stop.
    pub audio_changed: Condvar,
    pub stop: AtomicBool,
}

impl Hub {
    pub fn new(width: u32, height: u32, audio_enabled: bool) -> Arc<Self> {
        Arc::new(Hub {
            clients: Mutex::new(Vec::new()),
            next_id: AtomicU64::new(1),
            width,
            height,
            audio_enabled,
            wake: Wake::new(),
            audio_changed: Condvar::new(),
            stop: AtomicBool::new(false),
        })
    }

    pub fn add(&self, role: Role, tx: mpsc::UnboundedSender<Out>) -> Arc<Client> {
        let client = Arc::new(Client {
            id: self.next_id.fetch_add(1, Ordering::Relaxed),
            role,
            tx,
            video: AtomicBool::new(false),
            audio: AtomicBool::new(false),
            needs_keyframe: AtomicBool::new(true),
            started: AtomicBool::new(false),
            inflight: Mutex::new(VecDeque::new()),
            delay: Mutex::new(Delay { base_ms: f64::INFINITY, base_at: Instant::now(), queue_ms: 0.0 }),
            delivered: Mutex::new(Delivered { window_start: Instant::now(), bytes: 0, rate_kbps: 0.0 }),
        });
        self.clients.lock().unwrap().push(client.clone());
        client
    }

    pub fn remove(&self, id: u64) {
        self.clients.lock().unwrap().retain(|c| c.id != id);
        self.wake.signal();
        self.audio_changed.notify_all();
    }

    pub fn video_clients(&self) -> Vec<Arc<Client>> {
        self.clients.lock().unwrap().iter().filter(|c| c.video.load(Ordering::Relaxed)).cloned().collect()
    }

    pub fn audio_clients(&self) -> Vec<Arc<Client>> {
        self.clients.lock().unwrap().iter().filter(|c| c.audio.load(Ordering::Relaxed)).cloned().collect()
    }

    pub fn hello(&self, role: Role) -> String {
        serde_json::json!({
            "type": "hello",
            "w": self.width,
            "h": self.height,
            "audio": self.audio_enabled,
            "control": role == Role::Control,
        })
        .to_string()
    }
}
