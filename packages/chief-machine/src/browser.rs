//! Browser capacity uses a host-owned Chrome process and empty profile per
//! session, each in its own session host (`browser_host`) on Linux. No API
//! accepts a CDP address, executable, filesystem path, or JavaScript from the relay.
use crate::{browser_proxy, host_storage};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    time::{Duration, Instant},
};
use tokio::process::Child;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub enabled: bool,
    pub chrome: PathBuf,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub request_id: String,
    pub session_id: String,
    pub agent_id: String,
    pub operation: String,
    pub url: Option<String>,
    pub target: Option<Target>,
    pub text: Option<String>,
    pub values: Option<Vec<String>>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    #[serde(rename = "ref")]
    pub reference: Option<String>,
    pub labels: Option<Vec<String>>,
}

pub struct Session {
    pub(crate) agent: String,
    /// The session host: Chrome, its display and sound, and the relay.
    pub(crate) host: Child,
    /// Removed once the host has exited, so nothing it writes outlives it.
    pub(crate) directory: Option<tempfile::TempDir>,
    pub(crate) _proxy: browser_proxy::Proxy,
    pub(crate) last_used: Instant,
    /// What the agent is doing, as browser-ui activity, for live viewers.
    pub(crate) activity: tokio::sync::broadcast::Sender<String>,
    pub(crate) activity_sequence: u64,
}

impl Session {
    /// browser-ui's v1 activity message, carrying the agent's cursor.
    fn announce(&mut self, id: &str, action: &str, phase: &str, cursor: Option<(f64, f64)>) {
        self.activity_sequence += 1;
        let label = match action {
            "click" => "Clicking",
            "fill" => "Typing",
            _ => "Choosing",
        };
        let mut message = json!({
            "type": "activity",
            "v": 1,
            "id": id,
            "action": action,
            "label": label,
            "phase": phase,
            "timestamp": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_millis() as u64)
                .unwrap_or(0),
            "eventSequence": self.activity_sequence,
        });
        if let Some((x, y)) = cursor {
            message["agentCursor"] = json!({
                "x": x,
                "y": y,
                "pressed": action == "click" && phase == "started",
                "typing": action == "fill" && phase == "started",
            });
        }
        // Nobody watching is fine.
        let _ = self.activity.send(message.to_string());
    }
}
/// Ending a session stops its host and everything the host started, waits
/// for them to exit, then deletes the session's directory. Nothing is left
/// running or on disk once a session is gone.
impl Drop for Session {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(pid) = self.host.id() {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
        }
        let _ = self.host.start_kill();
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline && !matches!(self.host.try_wait(), Ok(Some(_))) {
            std::thread::sleep(Duration::from_millis(20));
        }
        if let Some(directory) = self.directory.take() {
            let path = directory.path().to_owned();
            if directory.close().is_err() {
                let _ = std::fs::remove_dir_all(path);
            }
        }
    }
}

pub const SESSION_PREFIX: &str = "chief-browser-";

/// Session folders left by a machine that stopped without ending its
/// sessions, such as after a crash or power loss. None are in use at start.
pub fn sweep_stale_sessions() {
    let Ok(entries) = std::fs::read_dir("/tmp") else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(suffix) = name
            .to_str()
            .and_then(|name| name.strip_prefix(SESSION_PREFIX))
        else {
            continue;
        };
        if suffix.len() != 6 || !suffix.chars().all(|c| c.is_ascii_alphanumeric()) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.uid() != unsafe { libc::getuid() } {
                continue;
            }
        }
        if metadata.is_dir() {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// A live viewer's way into a session: the session host's socket for its
/// media and input, and the agent's activity.
pub struct StreamTarget {
    pub media: PathBuf,
    pub activity: tokio::sync::broadcast::Receiver<String>,
}

pub struct Sessions {
    sessions: HashMap<String, Session>,
}
impl Default for Sessions {
    fn default() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(host_storage::root()?.join("browser.json"))
}
pub fn settings() -> Result<Settings, String> {
    host_storage::load(&settings_path()?)
}
pub fn enabled() -> bool {
    settings().is_ok_and(|s| s.enabled)
}

pub async fn cli(args: &[String]) -> Result<(), String> {
    match args.first().map(String::as_str) {
        Some("enable") => {
            let option = |key: &str| {
                args.iter()
                    .position(|v| v == key)
                    .and_then(|i| args.get(i + 1))
                    .map(PathBuf::from)
            };
            if !cfg!(target_os = "linux") {
                return Err("Browser hosting needs Linux for now.".into());
            }
            let chrome = option("--chrome")
                .ok_or("Supply --chrome with the absolute Google Chrome executable path.")?;
            if !chrome.is_absolute() || !chrome.is_file() {
                return Err("Use an absolute Google Chrome executable path.".into());
            }
            host_storage::save(
                &settings_path()?,
                &Settings {
                    enabled: true,
                    chrome,
                },
            )?;
            println!("Browser role enabled. Each session gets a new, isolated Chrome on its own virtual display, with public-only egress. Pair this machine, then run chief-machine serve.");
            Ok(())
        }
        Some("disable") => {
            let mut s = settings()?;
            s.enabled = false;
            host_storage::save(&settings_path()?, &s)?;
            println!("Browser role disabled.");
            Ok(())
        }
        Some("status") => {
            println!(
                "Browser role: {}",
                if enabled() { "enabled" } else { "disabled" }
            );
            Ok(())
        }
        _ => {
            println!("chief-machine browser enable --chrome <absolute-path>\nchief-machine browser disable\nchief-machine browser status\n\nNo personal Chrome profiles, raw CDP attachments, shell, or arbitrary JavaScript are exposed.");
            Ok(())
        }
    }
}

impl Sessions {
    /// Where a live viewer of one session attaches. Only sessions this
    /// machine owns, for the agent that owns them, are found.
    #[cfg(target_os = "linux")]
    pub fn stream_target(&self, session_id: &str, agent_id: &str) -> Option<StreamTarget> {
        let session = self.sessions.get(session_id).filter(|session| session.agent == agent_id)?;
        Some(StreamTarget {
            media: session.directory.as_ref()?.path().join("relay.sock"),
            activity: session.activity.subscribe(),
        })
    }
    pub fn reap(&mut self) {
        if !enabled() {
            self.sessions.clear();
            return;
        }
        // Idle sessions, and ones whose host or Chrome has ended, are ended.
        self.sessions.retain(|_, s| {
            if s.last_used.elapsed() >= Duration::from_secs(900) {
                eprintln!("browser session ended: idle for 15 minutes");
                return false;
            }
            if !matches!(s.host.try_wait(), Ok(None)) {
                eprintln!("browser session ended: its browser exited");
                return false;
            }
            true
        });
    }
    pub async fn execute(&mut self, request: Request) -> Value {
        let id = request.request_id.clone();
        // A command that overran or outlived the browser role is abandoned
        // mid-flight, so its page can't be trusted; other errors (a stale
        // element reference, a page that wouldn't load) leave the session be.
        let (result, abandoned) = tokio::select! {
            result = tokio::time::timeout(Duration::from_secs(35), self.operation(&request)) => match result {
                Ok(result) => (result, false),
                Err(_) => (Err("Browser operation deadline exceeded.".into()), true),
            },
            _ = async { loop { tokio::time::sleep(Duration::from_secs(1)).await; if !enabled() { break; } } } => {
                (Err("Browser role disabled during operation.".into()), true)
            }
        };
        if abandoned
            && self
                .sessions
                .get(&request.session_id)
                .is_some_and(|session| session.agent == request.agent_id)
        {
            if let Err(error) = &result {
                eprintln!("browser session ended: {} {error}", request.operation);
            }
            self.sessions.remove(&request.session_id);
        }

        match result {
            Ok(output) => json!({"type":"browser.result","requestId":id,"ok":true,"output":output}),
            Err(error) => json!({"type":"browser.result","requestId":id,"ok":false,"error":error}),
        }
    }

    async fn operation(&mut self, request: &Request) -> Result<Value, String> {
        if !enabled() {
            self.sessions.clear();
            return Err("Browser role is disabled.".into());
        }
        validate_request(request)?;
        if request.operation == "open" {
            browser_proxy::destination(request.url.as_deref().ok_or("Missing page URL.")?)?;
        }
        // Ephemeral contexts cannot be resurrected from an unrelated browser after reconnect.
        self.sessions
            .retain(|_, s| s.last_used.elapsed() < Duration::from_secs(900));
        if request.operation == "close" {
            if let Some(s) = self.sessions.get(&request.session_id) {
                if s.agent != request.agent_id {
                    return Err("Browser session belongs to another agent.".into());
                }
            }
            if self.sessions.remove(&request.session_id).is_some() {
                eprintln!("browser session ended: closed by the agent");
            }
            return Ok(json!({"closed":true}));
        }
        if request.operation == "open" && !self.sessions.contains_key(&request.session_id) {
            if self.sessions.len() >= 4 {
                return Err("All four isolated browser slots are occupied. Close a session before opening another.".into());
            }
            let session = launch(&request.agent_id).await?;
            self.sessions.insert(request.session_id.clone(), session);
        }
        let session = self
            .sessions
            .get_mut(&request.session_id)
            .ok_or("No owned browser session exists. Call browser_open first.")?;
        if session.agent != request.agent_id {
            return Err("Browser session belongs to another agent.".into());
        }
        if session
            .host
            .try_wait()
            .map_err(|_| "Cannot inspect owned browser.")?
            .is_some()
        {
            return Err(
                "Owned Chrome process ended. Close this session and open a fresh one.".into(),
            );
        }
        session.last_used = Instant::now();
        // Viewers see the agent's cursor move to what it's acting on.
        let acting = matches!(request.operation.as_str(), "click" | "fill" | "select");
        let cursor = match (&request.target, acting) {
            (Some(target), true) => {
                let located = host_request(session, json!({"operation": "locate", "target": target_json(target)})).await;
                located.ok().and_then(|at| Some((at["x"].as_f64()?, at["y"].as_f64()?)))
            }
            _ => None,
        };
        if acting {
            session.announce(&request.request_id, &request.operation, "started", cursor);
        }
        let result = Self::act(session, request).await;
        if acting {
            session.announce(&request.request_id, &request.operation, "completed", cursor);
        }
        result
    }

    /// The session host carries the action out with agent-browser.
    async fn act(session: &mut Session, request: &Request) -> Result<Value, String> {
        if request.operation == "open" {
            browser_proxy::destination(request.url.as_deref().ok_or("Missing page URL.")?)?;
        }
        let mut action = json!({"operation": request.operation});
        if let Some(url) = &request.url {
            action["url"] = json!(url);
        }
        if let Some(target) = &request.target {
            action["target"] = target_json(target);
        }
        if let Some(text) = &request.text {
            action["text"] = json!(text);
        }
        if let Some(values) = &request.values {
            action["values"] = json!(values);
        }
        let output = host_request(session, action).await?;
        // The proxy keeps Chrome on the public web; this keeps reports honest.
        if let Some(url) = output["url"].as_str().filter(|url| *url != "about:blank") {
            browser_proxy::destination(url)?;
        }
        Ok(output)
    }
}

fn target_json(target: &Target) -> Value {
    let mut value = json!({});
    if let Some(reference) = &target.reference {
        value["ref"] = json!(reference);
    }
    if let Some(labels) = &target.labels {
        value["labels"] = json!(labels);
    }
    value
}

async fn host_request(session: &Session, action: Value) -> Result<Value, String> {
    #[cfg(target_os = "linux")]
    {
        let directory = session.directory.as_ref().ok_or("The browser session has ended.")?;
        crate::browser_launch::request(directory.path(), action).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (session, action);
        Err("Browser hosting needs Linux for now.".into())
    }
}

fn validate_request(request: &Request) -> Result<(), String> {
    if uuid::Uuid::parse_str(&request.request_id).is_err()
        || uuid::Uuid::parse_str(&request.session_id).is_err()
        || request.agent_id.is_empty()
        || request.agent_id.len() > 128
        || ![
            "open",
            "snapshot",
            "click",
            "fill",
            "select",
            "screenshot",
            "close",
        ]
        .contains(&request.operation.as_str())
        || request.url.as_ref().is_some_and(|s| s.len() > 4096)
        || request.text.as_ref().is_some_and(|s| s.len() > 16_000)
        || request
            .values
            .as_ref()
            .is_some_and(|v| v.len() > 30 || v.iter().any(|s| s.len() > 1000))
    {
        return Err("Invalid browser command envelope.".into());
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
async fn launch(_agent: &str) -> Result<Session, String> {
    Err("Browser hosting needs Linux for now.".into())
}

#[cfg(target_os = "linux")]
use crate::browser_launch::launch;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_cannot_choose_scripts_or_existing_browser() {
        let value = json!({"requestId":uuid::Uuid::new_v4(),"sessionId":uuid::Uuid::new_v4(),"agentId":"chief","operation":"eval","cdp":"http://localhost:9222"});
        assert!(serde_json::from_value::<Request>(value).is_err());
        let req:Request=serde_json::from_value(json!({"requestId":uuid::Uuid::new_v4(),"sessionId":uuid::Uuid::new_v4(),"agentId":"chief","operation":"snapshot"})).unwrap();
        assert!(validate_request(&req).is_ok());
    }
}
