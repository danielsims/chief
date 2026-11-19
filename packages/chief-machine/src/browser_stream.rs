//! A live view of an owned browser session, served on loopback for this
//! machine's Cloudflare tunnel. The relay never carries the media: it only
//! signs viewer tickets with this machine's stream secret. A ticket is for one
//! session, lasts a minute and opens one viewer; without a valid one the
//! socket is refused before any browser is touched.
//!
//! The session host's relay sends the screen (H.264) and sound (Opus) as
//! binary messages; see `chief_browser_relay` for the format. Text from here
//! is JSON: the relay's `hello`, the agent's `activity` and the page's `url`.
//! A viewer sends the relay's short commands (`a,…`, `kf`, `v,…`, `au,…`)
//! and, when it may control the page, browser-ui input as JSON.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::{HeaderValue, StatusCode};
use tokio_tungstenite::tungstenite::Message;

use crate::browser::{Sessions, StreamTarget};
use crate::browser_media;
use tokio::io::AsyncWriteExt;

/// The loopback port the tunnel forwards to. Fixed, because the relay sets
/// the tunnel's route when it creates it.
pub const PORT: u16 = 47615;
const PROTOCOL: &str = "chief-stream.v1";
const TICKET_PREFIX: &str = "chief-ticket.";
/// Viewer messages are small input events; anything larger is dropped.
const MAX_VIEWER_MESSAGE: usize = 8_192;

#[derive(Deserialize)]
struct Claims {
    v: u8,
    /// The browser session this ticket opens.
    s: String,
    /// The agent that owns that session. Session IDs come from agents, so a
    /// ticket only opens a session that belongs to the agent it was issued for.
    a: String,
    /// Whether the viewer may click and type, not just watch.
    c: bool,
    /// Expiry, in milliseconds since the epoch.
    exp: u64,
    /// Spent on first use.
    n: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// Spent tickets, by nonce, until they would have expired anyway.
#[derive(Default)]
struct Spent(HashMap<String, u64>);

impl Spent {
    fn spend(&mut self, nonce: &str, expires: u64) -> bool {
        let now = now_ms();
        self.0.retain(|_, until| *until > now);
        if self.0.contains_key(nonce) {
            return false;
        }
        self.0.insert(nonce.into(), expires);
        true
    }
}

fn verify(secret: &[u8], ticket: &str) -> Option<Claims> {
    let (payload, signature) = ticket.split_once('.')?;
    let decode = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).ok()?;
    mac.update(payload.as_bytes());
    mac.verify_slice(&decode.decode(signature).ok()?).ok()?;
    let claims: Claims = serde_json::from_slice(&decode.decode(payload).ok()?).ok()?;
    (claims.v == 1 && claims.exp > now_ms() && claims.exp < now_ms() + 5 * 60_000).then_some(claims)
}

/// Serves live views until the process stops. Binds loopback only, so the
/// tunnel is the one way in.
pub async fn serve(secret: Vec<u8>, sessions: Arc<Mutex<Sessions>>) -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", PORT))
        .await
        .map_err(|error| format!("Cannot open the browser stream port {PORT}: {error}"))?;
    let secret = Arc::new(secret);
    let spent = Arc::new(Mutex::new(Spent::default()));
    loop {
        let Ok((socket, _)) = listener.accept().await else {
            continue;
        };
        let (secret, spent, sessions) = (secret.clone(), spent.clone(), sessions.clone());
        tokio::spawn(async move {
            if let Err(error) = view(socket, &secret, &spent, &sessions).await {
                eprintln!("browser stream: {error}");
            }
        });
    }
}

fn refuse(status: StatusCode) -> ErrorResponse {
    let mut response = ErrorResponse::new(None);
    *response.status_mut() = status;
    response
}

/// One viewer: checks its ticket during the handshake, then mirrors the page.
async fn view(
    socket: TcpStream,
    secret: &[u8],
    spent: &Mutex<Spent>,
    sessions: &Mutex<Sessions>,
) -> Result<(), String> {
    let mut admitted: Option<Claims> = None;
    let viewer =
        tokio_tungstenite::accept_hdr_async(socket, |request: &Request, mut response: Response| {
            let session = request
                .uri()
                .path()
                .strip_prefix("/stream/")
                .unwrap_or_default();
            let ticket = request
                .headers()
                .get_all("sec-websocket-protocol")
                .iter()
                .filter_map(|value| value.to_str().ok())
                .flat_map(|value| value.split(','))
                .map(str::trim)
                .find_map(|protocol| protocol.strip_prefix(TICKET_PREFIX));
            let Some(claims) = ticket.and_then(|ticket| verify(secret, ticket)) else {
                return Err(refuse(StatusCode::UNAUTHORIZED));
            };
            if claims.s != session {
                return Err(refuse(StatusCode::FORBIDDEN));
            }
            response
                .headers_mut()
                .insert("sec-websocket-protocol", HeaderValue::from_static(PROTOCOL));
            admitted = Some(claims);
            Ok(response)
        })
        .await
        .map_err(|error| error.to_string())?;
    let claims = admitted.ok_or("Viewer was not admitted.")?;
    if !spent.lock().await.spend(&claims.n, claims.exp) {
        return Err("Ticket already used.".into());
    }
    let target = sessions
        .lock()
        .await
        .stream_target(&claims.s, &claims.a)
        .ok_or("That browser session isn't open on this machine.")?;
    mirror(viewer, target, claims.c).await
}

/// Relays one viewer: the session's media out, and its commands and (when
/// allowed) input in. The session host plays input into the page.
async fn mirror(
    viewer: tokio_tungstenite::WebSocketStream<TcpStream>,
    target: crate::browser::StreamTarget,
    control: bool,
) -> Result<(), String> {
    let StreamTarget { media, mut activity } = target;
    let mut media = tokio::net::UnixStream::connect(&media)
        .await
        .map_err(|_| "Cannot reach the session's stream.")?;
    let role = if control { browser_media::ROLE_CONTROL } else { browser_media::ROLE_WATCH };
    media.write_u8(role).await.map_err(|error| error.to_string())?;
    let (from_media, mut to_media) = media.into_split();
    let mut from_media = browser_media::frames(from_media);
    let (mut to_viewer, mut from_viewer) = viewer.split();

    let opened = std::time::Instant::now();
    let reason: String = loop {
        tokio::select! {
            frame = from_media.recv() => {
                let message = match frame {
                    Some(Ok((browser_media::BINARY, bytes))) => Message::binary(bytes),
                    Some(Ok((_, text))) => match String::from_utf8(text) {
                        Ok(text) => Message::text(text),
                        Err(_) => continue,
                    },
                    Some(Err(error)) => break format!("the session's stream ended ({error})"),
                    None => break "the session's stream ended".into(),
                };
                if let Err(error) = to_viewer.send(message).await { break format!("sending to the viewer failed ({error})") }
            }
            event = activity.recv() => {
                match event {
                    Ok(event) => {
                        if let Err(error) = to_viewer.send(Message::text(event)).await { break format!("sending to the viewer failed ({error})") }
                    }
                    // A slow viewer skips cursor moves; it never stalls the agent.
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break "the session ended".into(),
                }
            }
            incoming = from_viewer.next() => {
                let message = match incoming {
                    Some(Ok(message)) => message,
                    Some(Err(error)) => break format!("the viewer's connection failed ({error})"),
                    None => break "the viewer left".into(),
                };
                if let Message::Close(frame) = &message {
                    break format!("the viewer closed ({frame:?})");
                }
                let Message::Text(text) = message else { continue };
                // Input is the controller's alone; the host checks it too.
                if text.len() > MAX_VIEWER_MESSAGE || (!control && text.starts_with('{')) { continue }
                if let Err(error) = browser_media::write(&mut to_media, browser_media::TEXT, text.as_bytes()).await {
                    break format!("the session's stream ended ({error})");
                }
            }
        }
    };
    eprintln!("browser viewer left after {}s: {reason}", opened.elapsed().as_secs());
    let _ = to_viewer.close().await;
    Ok(())
}
