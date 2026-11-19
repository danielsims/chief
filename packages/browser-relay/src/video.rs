//! Capture, convert, encode and fan out, on one thread, only while someone watches.
//! Pacing and rate control adapted from voxl (MIT); see NOTICE.

use crate::capture::Capturer;
use crate::convert::I420;
use crate::encoder::{Encoder, EncoderConfig, Planes};
use crate::hub::{wait_any, Client, Hub, Role};
use crate::Config;
use bytes::Bytes;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

const HEADER: usize = 16;
/// Starting bitrate cap for a new viewer (kbit/s).
const START_KBPS: f64 = 8000.0;
/// Watchers that fall behind can't force keyframes more often than this.
const WATCHER_KEYFRAME_GAP: Duration = Duration::from_secs(1);

/// The viewer whose connection paces the stream: the controller, else the
/// watcher with the least queueing. Everyone else keeps up or skips ahead.
fn steering(clients: &[Arc<Client>]) -> Option<Arc<Client>> {
    let started = || clients.iter().filter(|c| c.started.load(Ordering::Relaxed));
    started().find(|c| c.role == Role::Control).cloned().or_else(|| {
        started().min_by(|a, b| a.queue_ms().total_cmp(&b.queue_ms())).cloned()
    })
}

/// Delay-based bitrate: back off toward the delivered rate when acks show
/// queueing, probe upward while the content presses against the cap.
struct RateCtl {
    target: f64,
    max: f64,
    min: f64,
    last_eval: Instant,
    last_dec: Instant,
    last_inc: Instant,
    slow_start: bool,
    /// Delivered rate at the last congestion: the path's likely capacity.
    ceiling: f64,
    ceiling_at: Instant,
}

impl RateCtl {
    fn new(min: f64, max: f64) -> Self {
        let past = Instant::now() - Duration::from_secs(10);
        RateCtl {
            target: START_KBPS.clamp(min, max),
            max,
            min,
            last_eval: past,
            last_dec: past,
            last_inc: past,
            slow_start: true,
            ceiling: f64::MAX,
            ceiling_at: past,
        }
    }

    fn update(&mut self, steer: &Client) {
        if self.last_eval.elapsed() < Duration::from_millis(100) {
            return;
        }
        self.last_eval = Instant::now();
        let queue = steer.queue_ms();
        let (_, age) = steer.backlog();
        let delivered = steer.delivered_kbps();
        let congested = queue > 30.0 || age as f64 > steer.rtt_ms() + 80.0;
        let clear = queue <= 15.0;
        let now = Instant::now();
        if congested && self.last_dec.elapsed() >= Duration::from_millis(300) {
            let mut target = self.target * 0.85;
            // Delivery only says something about capacity while pushing near the cap.
            if delivered > 0.0 && delivered >= self.target * 0.5 {
                self.ceiling = delivered;
                self.ceiling_at = now;
                target = target.min(delivered * 0.85);
            }
            self.target = target.max(self.min);
            self.last_dec = now;
            self.slow_start = false;
        } else if !congested && clear && delivered >= self.target * 0.5 {
            if self.slow_start {
                if self.last_inc.elapsed() >= Duration::from_millis(250) {
                    self.target = (self.target * 1.5).min(self.max);
                    self.last_inc = now;
                }
            } else if self.last_dec.elapsed() >= Duration::from_secs(1) {
                if self.ceiling_at.elapsed() >= Duration::from_secs(15) {
                    self.ceiling = f64::MAX;
                }
                // Recover quickly to just under the known capacity, then probe gently.
                if self.target < self.ceiling * 0.9 && self.last_inc.elapsed() >= Duration::from_millis(200) {
                    self.target = (self.target * 1.06 + 100.0).min(self.ceiling * 0.9).min(self.max);
                    self.last_inc = now;
                } else if self.target >= self.ceiling * 0.9 && self.last_inc.elapsed() >= Duration::from_secs(1) {
                    self.target = (self.target * 1.02).min(self.max);
                    self.last_inc = now;
                }
            }
        }
    }
}

pub(crate) fn run(mut cap: Capturer, cfg: Config, hub: Arc<Hub>) -> Result<(), String> {
    let (w, h) = (cap.width as usize, cap.height as usize);
    let mut enc = Encoder::new(&EncoderConfig {
        width: cap.width,
        height: cap.height,
        fps: cfg.fps,
        threads: cfg.encode_threads,
        crf: cfg.crf,
        max_kbps: START_KBPS as u32,
    })?;
    let mut frame = I420::new(w, h);
    let blocks = w.div_ceil(16) * h.div_ceil(16);
    // Macroblocks sent at motion quality since the last paint-over.
    let mut touched = vec![0u8; blocks];
    let interval = Duration::from_secs_f64(1.0 / f64::from(cfg.fps));
    let interval_ms = interval.as_secs_f64() * 1000.0;
    // Slightly early captures keep source jitter from aliasing into dropped frames.
    let min_interval = interval.mul_f64(0.85);
    let epoch = Instant::now();
    let mut last_capture = epoch - interval;
    let mut last_motion = epoch;
    let mut last_key = epoch - WATCHER_KEYFRAME_GAP;
    let mut paintover_left = 0u32;
    let mut rate = RateCtl::new(f64::from(cfg.min_kbps), f64::from(cfg.max_kbps));
    let mut applied: Option<(f32, u32)> = None;
    let mut watching = false;
    let mut frame_id: u32 = 0;
    let mut out = Vec::with_capacity(256 << 10);

    while !hub.stop.load(Ordering::Relaxed) {
        cap.pump()?;
        hub.wake.drain();
        let clients = hub.video_clients();
        if clients.is_empty() {
            if watching {
                watching = false;
                rate = RateCtl::new(f64::from(cfg.min_kbps), f64::from(cfg.max_kbps));
                paintover_left = 0;
            }
            // Damage still has to be read off the socket; nothing is captured.
            cap.take_damage();
            cap.take_mb_map();
            wait_any(&[cap.fd(), hub.wake.fd()], -1);
            continue;
        }
        if !watching {
            watching = true;
            cap.grab(cap.full())?;
            cap.convert(&mut frame, cap.full(), cfg.convert_threads);
            cap.take_damage();
            cap.take_mb_map();
        }

        // A watcher that fell behind rejoins at a keyframe once its backlog clears.
        for c in &clients {
            c.drop_if_stalled();
            if !c.started.load(Ordering::Relaxed) && !c.needs_keyframe.load(Ordering::Relaxed) && c.backlog().0 == 0 {
                c.needs_keyframe.store(true, Ordering::Relaxed);
            }
        }
        let steer = steering(&clients);
        if let Some(s) = &steer {
            rate.update(s);
        }
        let key_wanted: Vec<&Arc<Client>> =
            clients.iter().filter(|c| c.needs_keyframe.load(Ordering::Relaxed)).collect();
        // The steering viewer, or anyone when nobody steers yet, gets one at once.
        let urgent = key_wanted.iter().any(|c| steer.as_ref().is_none_or(|s| s.id == c.id));
        let key_wait = WATCHER_KEYFRAME_GAP.saturating_sub(last_key.elapsed());
        let want_key = !key_wanted.is_empty() && (urgent || key_wait.is_zero());
        let paintover_due = paintover_left > 0 && last_motion.elapsed() >= cfg.paintover_delay;

        if !cap.damaged && !want_key && !paintover_due {
            let mut timeout: i32 = -1;
            if paintover_left > 0 {
                timeout = cfg.paintover_delay.saturating_sub(last_motion.elapsed()).as_millis() as i32 + 1;
            }
            if !key_wanted.is_empty() {
                let ms = key_wait.as_millis() as i32 + 1;
                timeout = if timeout < 0 { ms } else { timeout.min(ms) };
            }
            wait_any(&[cap.fd(), hub.wake.fd()], timeout);
            continue;
        }
        let since = last_capture.elapsed();
        if since < min_interval {
            let rest = min_interval - since;
            wait_any(&[hub.wake.fd()], (rest.as_micros() as i32 + 999) / 1000);
            continue;
        }
        if !want_key && steer.as_ref().is_some_and(|s| s.lagging(interval_ms)) {
            wait_any(&[cap.fd(), hub.wake.fd()], 4);
            continue;
        }

        let captured_at = Instant::now();
        let dirty = cap.take_mb_map();
        let band = cap.take_damage();
        if let Some(b) = band {
            cap.grab(b)?;
            cap.convert(&mut frame, b, cfg.convert_threads);
        }
        let motion = band.is_some();
        if !motion && !want_key && !paintover_due {
            continue;
        }

        // What x264 encodes: changed blocks for motion, blocks sent at motion
        // quality for a paint-over, everything for a keyframe. It wants
        // X264_MBINFO_CONSTANT (1) on the blocks it may skip.
        let paintover = !motion && !want_key;
        let mut mb_info: Option<Vec<u8>> = None;
        if want_key {
            touched.fill(1);
            paintover_left = cfg.paintover_burst;
            last_motion = captured_at;
        } else if motion {
            for (t, d) in touched.iter_mut().zip(&dirty) {
                *t |= d;
            }
            mb_info = Some(dirty.iter().map(|&d| (d == 0) as u8).collect());
            paintover_left = cfg.paintover_burst;
            last_motion = captured_at;
        } else {
            if !touched.contains(&1) {
                paintover_left = 0;
                continue;
            }
            mb_info = Some(touched.iter().map(|&t| (t == 0) as u8).collect());
            paintover_left -= 1;
            if paintover_left == 0 {
                touched.fill(0);
            }
        }

        let target = rate.target as u32;
        if want_key {
            // A keyframe is the first thing a viewer sees: give it several frames' budget.
            let boost = target.saturating_mul(4).max(16_000);
            enc.set_rate_buf(cfg.crf, boost, boost / cfg.fps.max(1) * 8);
            applied = None;
        } else {
            let (crf, cap_kbps) =
                if paintover { (cfg.paintover_crf, target.saturating_mul(2)) } else { (cfg.crf, target) };
            let moved = applied.is_none_or(|(c, k)| c != crf || (cap_kbps as f64 - k as f64).abs() > k as f64 * 0.04);
            if moved {
                enc.set_rate(crf, cap_kbps);
                applied = Some((crf, cap_kbps));
            }
        }

        out.clear();
        out.resize(HEADER, 0);
        let stride_uv = frame.stride_uv();
        let planes = Planes { y: &frame.y, u: &frame.u, v: &frame.v, stride_y: w, stride_uv };
        let ts = captured_at.duration_since(epoch).as_millis() as i64;
        let key = enc.encode(&planes, ts, want_key, mb_info.as_deref_mut(), &mut out)?;
        last_capture = captured_at;
        if want_key {
            last_key = captured_at;
            for c in &key_wanted {
                c.needs_keyframe.store(false, Ordering::Relaxed);
            }
        }
        if out.len() <= HEADER {
            continue;
        }

        frame_id = frame_id.wrapping_add(1);
        // Capture to send, in 0.1 ms, for viewer stats.
        let pipe = (captured_at.elapsed().as_micros() / 100).min(u128::from(u32::MAX)) as u32;
        out[0] = 0x01;
        out[1] = u8::from(key) | if paintover { 2 } else { 0 };
        out[2..6].copy_from_slice(&frame_id.to_be_bytes());
        out[6..10].copy_from_slice(&pipe.to_be_bytes());
        // One stripe covering the whole screen: index 0 of 1, one part, at y 0.
        out[11] = 1;
        out[12] = 1;
        let message = [Bytes::copy_from_slice(&out)];
        for c in &clients {
            if !c.started.load(Ordering::Relaxed) {
                if !key {
                    continue;
                }
                c.restart();
                c.needs_keyframe.store(false, Ordering::Relaxed);
                c.started.store(true, Ordering::Relaxed);
            } else if steer.as_ref().is_some_and(|s| s.id != c.id) && c.lagging(interval_ms) {
                // Behind the steering viewer: skip ahead to the next keyframe.
                c.started.store(false, Ordering::Relaxed);
                continue;
            }
            if !c.push_frame(frame_id, &message, out.len()) {
                c.send(crate::Out::Text(r#"{"type":"close"}"#.into()));
                hub.remove(c.id);
            }
        }
    }
    Ok(())
}
