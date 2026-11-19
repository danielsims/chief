//! The session host's own DevTools connection to its Chrome, on the
//! session's private loopback: viewers' input goes in and the page's URL
//! comes out. The agent's actions go through agent-browser instead.
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

/// One DevTools connection. Replies go to whoever sent the command; events
/// go to subscribers.
pub struct Link {
    commands: mpsc::UnboundedSender<String>,
    pending: Pending,
    events: broadcast::Sender<Arc<Value>>,
    sequence: AtomicU64,
    tasks: [tokio::task::JoinHandle<()>; 2],
}

impl Drop for Link {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}

impl Link {
    /// Connects to Chrome's browser endpoint, a loopback WebSocket address.
    pub async fn connect(endpoint: &str) -> Result<Arc<Self>, String> {
        let mut config = tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default();
        config.max_message_size = Some(16 << 20);
        let (socket, _) = tokio_tungstenite::connect_async_with_config(endpoint, Some(config), false)
            .await
            .map_err(|_| "Cannot connect to the session's Chrome.")?;
        let (mut writer, mut reader) = socket.split();
        let (commands, mut queue) = mpsc::unbounded_channel::<String>();
        let pending: Pending = Arc::default();
        let events = broadcast::channel(64).0;
        let write = tokio::spawn(async move {
            while let Some(message) = queue.recv().await {
                if writer.send(Message::text(message)).await.is_err() {
                    break;
                }
            }
        });
        let (replies, notices) = (pending.clone(), events.clone());
        let read = tokio::spawn(async move {
            while let Some(Ok(message)) = reader.next().await {
                let Message::Text(text) = message else { continue };
                let Ok(value) = serde_json::from_str::<Value>(text.as_str()) else { continue };
                match value.get("id").and_then(Value::as_u64) {
                    Some(id) => {
                        if let Some(reply) = replies.lock().unwrap().remove(&id) {
                            let _ = reply.send(value);
                        }
                    }
                    None => {
                        let _ = notices.send(Arc::new(value));
                    }
                }
            }
            // Chrome is gone: every caller still waiting hears so.
            replies.lock().unwrap().clear();
        });
        Ok(Arc::new(Link { commands, pending, events, sequence: AtomicU64::new(0), tasks: [write, read] }))
    }

    fn command(&self, method: &str, params: Value, session: Option<&str>) -> (u64, String) {
        let id = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let mut command = json!({"id": id, "method": method, "params": params});
        if let Some(session) = session {
            command["sessionId"] = json!(session);
        }
        (id, command.to_string())
    }

    /// Sends a command and waits for Chrome's reply.
    pub async fn call(&self, method: &str, params: Value, session: Option<&str>) -> Result<Value, String> {
        let (id, text) = self.command(method, params, session);
        let (reply, answer) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, reply);
        if self.commands.send(text).is_err() {
            self.pending.lock().unwrap().remove(&id);
            return Err("The session's Chrome disconnected.".into());
        }
        let value = answer.await.map_err(|_| "The session's Chrome disconnected.")?;
        if value.get("error").is_some() {
            return Err("Chrome refused the command.".into());
        }
        value.get("result").cloned().ok_or("Missing Chrome result.".into())
    }

    /// Sends a command without waiting, as for a viewer's input.
    pub fn send(&self, method: &str, params: Value, session: Option<&str>) -> bool {
        self.commands.send(self.command(method, params, session).1).is_ok()
    }

    pub fn events(&self) -> broadcast::Receiver<Arc<Value>> {
        self.events.subscribe()
    }
}
