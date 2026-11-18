//! A live view of an owned browser session, served on loopback for this
//! machine's Cloudflare tunnel. The relay never carries the frames: it only
//! signs viewer tickets with this machine's stream secret. A ticket is for one
//! session, lasts a minute and opens one viewer; without a valid one the
//! socket is refused before any browser is touched.
//!
//! Frames and input use agent-browser's stream protocol, so the app's viewer
//! draws them as it draws any other agent browser.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::{HeaderValue, StatusCode};
use tokio_tungstenite::tungstenite::Message;

use crate::browser::Sessions;

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
    let (endpoint, target) = sessions
        .lock()
        .await
        .stream_target(&claims.s)
        .ok_or("That browser session isn't open on this machine.")?;
    mirror(viewer, &endpoint, &target, claims.c).await
}

/// A second debugging connection to the session's page: it screencasts to
/// the viewer and, when allowed, takes the viewer's clicks and keys.
async fn mirror(
    viewer: tokio_tungstenite::WebSocketStream<TcpStream>,
    endpoint: &str,
    target: &str,
    control: bool,
) -> Result<(), String> {
    let (chrome, _) = tokio_tungstenite::connect_async(endpoint)
        .await
        .map_err(|_| "Cannot reach the session's browser.")?;
    let (mut to_chrome, mut from_chrome) = chrome.split();
    let (mut to_viewer, mut from_viewer) = viewer.split();
    let mut next_id = 0u64;
    let mut call = |method: &str, params: Value, session: Option<&str>| {
        next_id += 1;
        let mut command = json!({"id": next_id, "method": method, "params": params});
        if let Some(session) = session {
            command["sessionId"] = json!(session);
        }
        (next_id, Message::text(command.to_string()))
    };

    let (attach_id, attach) = call(
        "Target.attachToTarget",
        json!({"targetId": target, "flatten": true}),
        None,
    );
    to_chrome
        .send(attach)
        .await
        .map_err(|error| error.to_string())?;
    let session = loop {
        let Some(Ok(Message::Text(text))) = from_chrome.next().await else {
            return Err("The browser closed while attaching.".into());
        };
        let value: Value = serde_json::from_str(text.as_str()).unwrap_or_default();
        if value["id"].as_u64() == Some(attach_id) {
            break value["result"]["sessionId"]
                .as_str()
                .ok_or("Cannot attach to the session's page.")?
                .to_string();
        }
    };
    let (metrics_id, metrics) = call("Page.getLayoutMetrics", json!({}), Some(&session));
    for (_, message) in [
        call("Page.enable", json!({}), Some(&session)),
        (metrics_id, metrics),
        call(
            "Page.startScreencast",
            json!({"format": "jpeg", "quality": 70, "maxWidth": 1280, "maxHeight": 1280}),
            Some(&session),
        ),
    ] {
        to_chrome
            .send(message)
            .await
            .map_err(|error| error.to_string())?;
    }

    loop {
        tokio::select! {
            incoming = from_chrome.next() => {
                let Some(Ok(Message::Text(text))) = incoming else { break };
                let value: Value = serde_json::from_str(text.as_str()).unwrap_or_default();
                if value["id"].as_u64() == Some(metrics_id) {
                    let viewport = &value["result"]["cssLayoutViewport"];
                    let status = json!({
                        "type": "status",
                        "connected": true,
                        "screencasting": true,
                        "viewportWidth": viewport["clientWidth"].as_u64().unwrap_or(1280),
                        "viewportHeight": viewport["clientHeight"].as_u64().unwrap_or(800),
                    });
                    if to_viewer.send(Message::text(status.to_string())).await.is_err() { break }
                    continue;
                }
                if value["sessionId"].as_str() != Some(session.as_str()) { continue }
                match value["method"].as_str() {
                    Some("Page.screencastFrame") => {
                        let params = &value["params"];
                        let frame = json!({"type": "frame", "data": params["data"], "metadata": params["metadata"]});
                        if to_viewer.send(Message::text(frame.to_string())).await.is_err() { break }
                        // Acknowledged once sent, so a slow viewer slows the cast.
                        let (_, ack) = call("Page.screencastFrameAck", json!({"sessionId": params["sessionId"]}), Some(&session));
                        if to_chrome.send(ack).await.is_err() { break }
                    }
                    Some("Page.frameNavigated") if value["params"]["frame"]["parentId"].is_null() => {
                        let url = json!({"type": "url", "url": value["params"]["frame"]["url"]});
                        if to_viewer.send(Message::text(url.to_string())).await.is_err() { break }
                    }
                    _ => {}
                }
            }
            incoming = from_viewer.next() => {
                let Some(Ok(message)) = incoming else { break };
                let Message::Text(text) = message else { continue };
                if !control || text.len() > MAX_VIEWER_MESSAGE { continue }
                let Some((method, params)) = input(text.as_str()) else { continue };
                let (_, command) = call(method, params, Some(&session));
                if to_chrome.send(command).await.is_err() { break }
            }
        }
    }
    let (_, stop) = call("Page.stopScreencast", json!({}), Some(&session));
    let _ = to_chrome.send(stop).await;
    let _ = to_viewer.close().await;
    Ok(())
}

/// A viewer's click or key as the debugging command that replays it. Only
/// mouse and keyboard input is accepted; nothing else reaches the browser.
fn input(text: &str) -> Option<(&'static str, Value)> {
    let value: Value = serde_json::from_str(text).ok()?;
    let event_type = value["eventType"].as_str()?;
    match value["type"].as_str()? {
        "input_mouse"
            if matches!(
                event_type,
                "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel"
            ) =>
        {
            Some((
                "Input.dispatchMouseEvent",
                json!({
                    "type": event_type,
                    "x": value["x"].as_f64()?,
                    "y": value["y"].as_f64()?,
                    "button": value["button"].as_str().unwrap_or("none"),
                    "clickCount": value["clickCount"].as_u64().unwrap_or(0).min(3),
                    "deltaX": value["deltaX"].as_f64().unwrap_or(0.0),
                    "deltaY": value["deltaY"].as_f64().unwrap_or(0.0),
                    "modifiers": value["modifiers"].as_u64().unwrap_or(0) & 15,
                }),
            ))
        }
        "input_keyboard" if matches!(event_type, "keyDown" | "keyUp" | "rawKeyDown" | "char") => {
            let mut params = json!({
                "type": event_type,
                "key": value["key"].as_str()?.chars().take(256).collect::<String>(),
                "code": value["code"].as_str()?.chars().take(256).collect::<String>(),
                "windowsVirtualKeyCode": value["windowsVirtualKeyCode"].as_u64().unwrap_or(0).min(65_535),
                "modifiers": value["modifiers"].as_u64().unwrap_or(0) & 15,
            });
            if let Some(text) = value["text"].as_str() {
                params["text"] = json!(text.chars().take(4_096).collect::<String>());
            }
            Some(("Input.dispatchKeyEvent", params))
        }
        _ => None,
    }
}
