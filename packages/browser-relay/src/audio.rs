//! The session's sound: its sink's monitor, recorded over the PulseAudio
//! protocol (PipeWire serves it on the session's own socket), to Opus in 10 ms
//! frames, only while a viewer has sound on.

use crate::hub::Hub;
use crate::Out;
use bytes::Bytes;
use pulseaudio::protocol;
use std::ffi::{c_int, c_void, CString};
use std::io::{BufReader, Read};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

extern "C" {
    fn opus_encoder_create(fs: i32, channels: c_int, application: c_int, error: *mut c_int) -> *mut c_void;
    fn opus_encoder_ctl(st: *mut c_void, request: c_int, ...) -> c_int;
    fn opus_encode(st: *mut c_void, pcm: *const i16, frame_size: c_int, data: *mut u8, max: i32) -> i32;
    fn opus_encoder_destroy(st: *mut c_void);
}

const RATE: u32 = 48_000;
/// Samples per channel in 10 ms.
const FRAME: usize = 480;
/// 10 ms of 16-bit stereo.
const FRAME_BYTES: usize = FRAME * 4;
const OPUS_APPLICATION_RESTRICTED_LOWDELAY: c_int = 2051;
const OPUS_SET_BITRATE: c_int = 4002;

pub struct AudioConfig {
    /// The session's PulseAudio socket.
    pub socket: PathBuf,
    /// The source to record: the session sink's monitor.
    pub source: String,
    pub bitrate: i32,
}

struct Opus(*mut c_void);

impl Opus {
    fn new(bitrate: i32) -> Result<Self, String> {
        let mut error = 0;
        let encoder = unsafe { opus_encoder_create(RATE as i32, 2, OPUS_APPLICATION_RESTRICTED_LOWDELAY, &mut error) };
        if encoder.is_null() {
            return Err(format!("opus init failed ({error})"));
        }
        unsafe { opus_encoder_ctl(encoder, OPUS_SET_BITRATE, bitrate as c_int) };
        Ok(Opus(encoder))
    }

    fn encode(&mut self, pcm: &[i16], packet: &mut [u8]) -> Option<usize> {
        let n = unsafe { opus_encode(self.0, pcm.as_ptr(), FRAME as c_int, packet.as_mut_ptr(), packet.len() as i32) };
        (n > 0).then_some(n as usize)
    }
}

impl Drop for Opus {
    fn drop(&mut self) {
        unsafe { opus_encoder_destroy(self.0) }
    }
}

/// Blocks until a viewer wants sound; false once the relay stops.
fn wait_for_listener(hub: &Hub) -> bool {
    let mut clients = hub.clients.lock().unwrap();
    loop {
        if hub.stop.load(Ordering::Relaxed) {
            return false;
        }
        if clients.iter().any(|c| c.audio.load(Ordering::Relaxed)) {
            return true;
        }
        clients = hub.audio_changed.wait(clients).unwrap();
    }
}

type Error = Box<dyn std::error::Error>;

/// A record stream of the source at 48 kHz 16-bit stereo, 10 ms per fragment.
fn connect(cfg: &AudioConfig) -> Result<(BufReader<UnixStream>, u16), Error> {
    let socket = UnixStream::connect(&cfg.socket)?;
    socket.set_read_timeout(Some(Duration::from_secs(2)))?;
    let mut socket = BufReader::new(socket);
    // The session's server is reachable only through its private socket, so
    // the cookie is unused, but the protocol still carries 256 bytes of one.
    let auth = protocol::AuthParams {
        version: protocol::MAX_VERSION,
        supports_shm: false,
        supports_memfd: false,
        cookie: vec![0; 256],
    };
    protocol::write_command_message(socket.get_mut(), 0, &protocol::Command::Auth(auth), protocol::MAX_VERSION)?;
    let (_, reply) = protocol::read_reply_message::<protocol::AuthReply>(&mut socket, protocol::MAX_VERSION)?;
    let version = protocol::MAX_VERSION.min(reply.version);
    let mut props = protocol::Props::new();
    props.set(protocol::Prop::ApplicationName, CString::new("chief-browser-relay")?);
    protocol::write_command_message(socket.get_mut(), 1, &protocol::Command::SetClientName(props), version)?;
    protocol::read_reply_message::<protocol::SetClientNameReply>(&mut socket, version)?;
    let params = protocol::RecordStreamParams {
        sample_spec: protocol::SampleSpec { format: protocol::SampleFormat::S16Le, channels: 2, sample_rate: RATE },
        channel_map: protocol::ChannelMap::stereo(),
        source_name: Some(CString::new(cfg.source.as_str())?),
        buffer_attr: protocol::stream::BufferAttr {
            max_length: (FRAME_BYTES * 8) as u32,
            target_length: u32::MAX,
            pre_buffering: u32::MAX,
            minimum_request_length: u32::MAX,
            fragment_size: FRAME_BYTES as u32,
        },
        flags: protocol::stream::StreamFlags { adjust_latency: true, no_move: true, ..Default::default() },
        ..Default::default()
    };
    protocol::write_command_message(socket.get_mut(), 2, &protocol::Command::CreateRecordStream(params), version)?;
    let (_, stream) = protocol::read_reply_message::<protocol::CreateRecordStreamReply>(&mut socket, version)?;
    let spec = stream.sample_spec;
    if spec.format != protocol::SampleFormat::S16Le || spec.channels != 2 || spec.sample_rate != RATE {
        return Err("the session's sound server changed the sample format".into());
    }
    Ok((socket, version))
}

pub(crate) fn run(cfg: AudioConfig, hub: Arc<Hub>) -> Result<(), String> {
    let mut opus = Opus::new(cfg.bitrate)?;
    let mut packet = vec![0u8; 4000];
    let mut pcm = vec![0i16; FRAME * 2];
    let mut pending: Vec<u8> = Vec::with_capacity(FRAME_BYTES * 4);
    let mut data = Vec::new();
    while wait_for_listener(&hub) {
        let (mut socket, version) = match connect(&cfg) {
            Ok(stream) => stream,
            Err(_) => {
                // The session's sound server is still starting, or gone.
                std::thread::sleep(Duration::from_secs(1));
                continue;
            }
        };
        pending.clear();
        loop {
            let Ok(descriptor) = protocol::read_descriptor(&mut socket) else { break };
            if descriptor.channel == u32::MAX {
                // A server notice, such as the source going away; any of them ends this stream.
                if protocol::Command::read_tag_prefixed(&mut socket, version).is_err() {
                    break;
                }
                continue;
            }
            if descriptor.length as usize > FRAME_BYTES * 64 {
                break;
            }
            data.resize(descriptor.length as usize, 0);
            if socket.read_exact(&mut data).is_err() {
                break;
            }
            if hub.stop.load(Ordering::Relaxed) {
                return Ok(());
            }
            let listeners = hub.audio_clients();
            if listeners.is_empty() {
                break;
            }
            pending.extend_from_slice(&data);
            let mut used = 0;
            while pending.len() - used >= FRAME_BYTES {
                let frame = &pending[used..used + FRAME_BYTES];
                used += FRAME_BYTES;
                // Silence costs nothing to skip; the viewer's jitter buffer covers it.
                if frame.iter().all(|&b| b == 0) {
                    continue;
                }
                for (sample, bytes) in pcm.iter_mut().zip(frame.chunks_exact(2)) {
                    *sample = i16::from_le_bytes([bytes[0], bytes[1]]);
                }
                let Some(n) = opus.encode(&pcm, &mut packet) else { continue };
                let mut message = Vec::with_capacity(n + 1);
                message.push(0x02);
                message.extend_from_slice(&packet[..n]);
                let message = Bytes::from(message);
                for c in &listeners {
                    c.send(Out::Binary(message.clone()));
                }
            }
            pending.drain(..used);
        }
    }
    Ok(())
}
