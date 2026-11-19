//! Streams one isolated browser session's screen (H.264) and sound (Opus) to
//! its viewers. The relay opens no sockets: the host hands it authenticated
//! viewers with `join`, and carries each viewer's messages both ways. Input
//! doesn't pass through here.
//!
//! Wire format, one connection per viewer:
//! - binary `0x01`: video, a 16-byte header (type, flags key|paint-over<<1,
//!   frame u32, capture-to-send u32 in 0.1 ms, stripe 0 of 1, 1 part, 0, y u16 0)
//!   then Annex-B H.264.
//! - binary `0x02`: one 10 ms Opus packet, 48 kHz stereo.
//! - text from the relay: `{"type":"hello","w","h","audio","control"}`, `{"type":"close"}`.
//! - text from the viewer: `a,<frame>` after decoding a frame, `kf` for a
//!   keyframe, `v,0|1` while the stream is on screen, `au,0|1` for sound.
#![cfg(target_os = "linux")]

mod audio;
mod capture;
mod convert;
mod encoder;
mod hub;
mod video;

pub use audio::AudioConfig;
pub use hub::{Out, Role};

use hub::{Client, Hub};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;
use tokio::sync::mpsc;

pub struct Config {
    /// The session's X display, e.g. `:99`.
    pub display: String,
    /// The session's Xvfb, whose `-shmem` framebuffer is read in place.
    pub xvfb_pid: Option<u32>,
    pub audio: Option<AudioConfig>,
    pub fps: u32,
    pub encode_threads: u32,
    pub convert_threads: usize,
    pub crf: f32,
    pub paintover_crf: f32,
    pub paintover_burst: u32,
    pub paintover_delay: Duration,
    pub min_kbps: u32,
    pub max_kbps: u32,
}

impl Config {
    pub fn new(display: impl Into<String>) -> Self {
        // Leave the rest of the machine to the browser: about half the cores, 1 to 4.
        let cores = std::thread::available_parallelism().map_or(2, |n| n.get());
        let threads = (cores / 2).clamp(1, 4);
        Config {
            display: display.into(),
            xvfb_pid: None,
            audio: None,
            fps: 30,
            encode_threads: threads as u32,
            convert_threads: threads,
            crf: 20.0,
            paintover_crf: 16.0,
            paintover_burst: 3,
            paintover_delay: Duration::from_millis(150),
            min_kbps: 10_000,
            max_kbps: 30_000,
        }
    }
}

pub struct Relay {
    hub: Arc<Hub>,
    threads: Vec<JoinHandle<()>>,
}

impl Relay {
    pub fn start(mut cfg: Config) -> Result<Relay, String> {
        let capturer = capture::Capturer::new(&cfg.display, cfg.xvfb_pid)?;
        let audio = cfg.audio.take();
        let hub = Hub::new(capturer.width, capturer.height, audio.is_some());
        let mut threads = Vec::new();
        let video_hub = hub.clone();
        threads.push(
            std::thread::Builder::new()
                .name("relay-video".into())
                .spawn(move || {
                    if let Err(e) = video::run(capturer, cfg, video_hub.clone()) {
                        eprintln!("browser-relay video stopped: {e}");
                    }
                    close_all(&video_hub);
                })
                .map_err(|e| e.to_string())?,
        );
        if let Some(audio) = audio {
            let audio_hub = hub.clone();
            threads.push(
                std::thread::Builder::new()
                    .name("relay-audio".into())
                    .spawn(move || {
                        if let Err(e) = audio::run(audio, audio_hub) {
                            eprintln!("browser-relay audio stopped: {e}");
                        }
                    })
                    .map_err(|e| e.to_string())?,
            );
        }
        Ok(Relay { hub, threads })
    }

    pub fn width(&self) -> u32 {
        self.hub.width
    }

    pub fn height(&self) -> u32 {
        self.hub.height
    }

    /// Adds a viewer. It gets `hello` at once and video after it sends `v,1`.
    pub fn join(&self, role: Role) -> Viewer {
        let (tx, rx) = mpsc::unbounded_channel();
        let client = self.hub.add(role, tx);
        client.send(Out::Text(self.hub.hello(role)));
        Viewer { client, hub: self.hub.clone(), rx }
    }

    /// Sends a text message (such as agent activity) to every viewer.
    pub fn broadcast(&self, text: &str) {
        for c in self.hub.clients.lock().unwrap().iter() {
            c.send(Out::Text(text.to_string()));
        }
    }
}

fn close_all(hub: &Hub) {
    for c in hub.clients.lock().unwrap().drain(..) {
        c.send(Out::Text(r#"{"type":"close"}"#.into()));
    }
}

impl Drop for Relay {
    fn drop(&mut self) {
        self.hub.stop.store(true, Ordering::Relaxed);
        self.hub.wake.signal();
        {
            let _clients = self.hub.clients.lock().unwrap();
            self.hub.audio_changed.notify_all();
        }
        for t in self.threads.drain(..) {
            let _ = t.join();
        }
    }
}

/// One connected viewer. Dropping it leaves the stream.
pub struct Viewer {
    client: Arc<Client>,
    hub: Arc<Hub>,
    rx: mpsc::UnboundedReceiver<Out>,
}

impl Viewer {
    pub fn role(&self) -> Role {
        self.client.role
    }

    /// The next message for this viewer; `None` once the relay stops.
    pub async fn next(&mut self) -> Option<Out> {
        self.rx.recv().await
    }

    /// Handles one text command from this viewer. Unknown commands are ignored.
    pub fn receive(&self, text: &str) {
        let (command, rest) = text.split_once(',').unwrap_or((text, ""));
        let c = &self.client;
        match command {
            "a" => {
                if let Ok(id) = rest.parse() {
                    c.on_ack(id);
                    self.hub.wake.signal();
                }
            }
            "kf" => {
                c.restart();
                self.hub.wake.signal();
            }
            "v" => {
                let on = rest == "1";
                c.video.store(on, Ordering::Relaxed);
                if on {
                    c.restart();
                }
                self.hub.wake.signal();
            }
            "au" => {
                let _clients = self.hub.clients.lock().unwrap();
                c.audio.store(rest == "1" && self.hub.audio_enabled, Ordering::Relaxed);
                self.hub.audio_changed.notify_all();
            }
            _ => {}
        }
    }
}

impl Drop for Viewer {
    fn drop(&mut self) {
        self.hub.remove(self.client.id);
    }
}
