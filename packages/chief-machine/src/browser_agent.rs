//! The agent's hands in a browser session: agent-browser, attached to the
//! session's Chrome over its private loopback DevTools port. Snapshots,
//! references and the commands that act on them are agent-browser's; this
//! only maps the agent's tool calls onto them and keeps its answers small.

use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

/// What a page's text may add to a snapshot the agent reads.
const MAX_TEXT: usize = 40_000;
/// Screenshots are sent back inline, as base64.
const MAX_SCREENSHOT_BASE64: usize = 866_668;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    #[serde(rename = "ref")]
    pub reference: Option<String>,
    pub labels: Option<Vec<String>>,
}

/// One tool call, as chief-machine forwards it.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Action {
    pub operation: String,
    pub url: Option<String>,
    pub target: Option<Target>,
    pub text: Option<String>,
    pub values: Option<Vec<String>>,
}

struct Ref {
    role: String,
    name: String,
}

pub struct AgentBrowser {
    program: PathBuf,
    port: u16,
    home: PathBuf,
    sockets: PathBuf,
    runtime: PathBuf,
    path: OsString,
    viewport: (f64, f64),
    /// The last snapshot's references, which labels resolve against.
    refs: HashMap<String, Ref>,
}

/// Roles a label most likely means, most likely first.
const ROLE_PRIORITY: [&str; 6] = ["radio", "checkbox", "button", "link", "tab", "option"];

/// Lower case, letters and digits only: "16‑core CPU" and "16-core cpu" match.
fn normalise(label: &str) -> String {
    label
        .to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// `e12` or `@e12` as agent-browser's `@e12`.
fn reference(value: &str) -> Option<String> {
    let id = value.trim().trim_start_matches('@');
    (id.len() > 1 && id.starts_with('e') && id[1..].chars().all(|c| c.is_ascii_digit()))
        .then(|| format!("@{id}"))
}

impl AgentBrowser {
    pub fn new(program: PathBuf, port: u16, dir: &std::path::Path, path: OsString, viewport: (u32, u32)) -> Self {
        AgentBrowser {
            program,
            port,
            home: dir.join("home"),
            sockets: dir.join("agent-browser"),
            runtime: dir.to_path_buf(),
            path,
            viewport: (f64::from(viewport.0), f64::from(viewport.1)),
            refs: HashMap::new(),
        }
    }

    /// One agent-browser command against the session's Chrome; its `data`.
    async fn run(&self, args: &[&str]) -> Result<Value, String> {
        std::fs::create_dir_all(&self.sockets).map_err(|_| "Cannot prepare agent-browser.")?;
        let port = self.port.to_string();
        let mut command = Command::new(&self.program);
        command
            .args(["--cdp", &port, "--session", "agent", "--json"])
            .args(args)
            .env_clear()
            .env("PATH", &self.path)
            .env("HOME", &self.home)
            .env("XDG_RUNTIME_DIR", &self.runtime)
            .env("AGENT_BROWSER_SOCKET_DIR", &self.sockets)
            .env("AGENT_BROWSER_DEFAULT_TIMEOUT", "20000")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let output = tokio::time::timeout(Duration::from_secs(30), command.output())
            .await
            .map_err(|_| "The browser command timed out.")?
            .map_err(|_| "Cannot run agent-browser.")?;
        let reply: Value = serde_json::from_slice(&output.stdout).map_err(|_| "agent-browser gave no answer.")?;
        if reply["success"] == true {
            Ok(reply["data"].clone())
        } else {
            let error = reply["error"].as_str().unwrap_or("The browser command failed.");
            Err(error.chars().take(500).collect())
        }
    }

    /// The first command that works, or the last one's error.
    async fn first_working(&self, commands: &[Vec<String>]) -> Result<(), String> {
        let mut last = "Use a reference from the current snapshot.".to_string();
        for command in commands {
            let args: Vec<&str> = command.iter().map(String::as_str).collect();
            match self.run(&args).await {
                Ok(_) => return Ok(()),
                Err(error) => last = error,
            }
        }
        Err(last)
    }

    /// The page as the agent reads it: text, and controls with references.
    pub async fn snapshot(&mut self) -> Result<Value, String> {
        let data = self.run(&["snapshot", "--compact"]).await?;
        self.refs = data["refs"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(id, value)| {
                let text = |key: &str| value[key].as_str().unwrap_or("").to_string();
                (id.clone(), Ref { role: text("role"), name: text("name") })
            })
            .collect();
        let snapshot = data["snapshot"].as_str().unwrap_or("");
        let mut text = String::new();
        for line in snapshot.lines() {
            if text.len() + line.len() + 1 > MAX_TEXT {
                break;
            }
            text.push_str(line);
            text.push('\n');
        }
        let controls: Vec<&str> = snapshot.lines().filter(|line| line.contains("[ref=")).take(100).map(str::trim).collect();
        let url = self.run(&["get", "url"]).await?;
        let title = self.run(&["get", "title"]).await?;
        Ok(json!({
            "url": url["url"].as_str().unwrap_or(""),
            "title": title["title"].as_str().unwrap_or(""),
            "text": text.trim_end(),
            "controls": controls,
        }))
    }

    /// The reference a target means: its own, or the control whose name
    /// best matches one of its labels.
    fn resolve(&self, target: &Target) -> Option<String> {
        if let Some(found) = target.reference.as_deref().and_then(reference) {
            return Some(found);
        }
        let labels = target.labels.as_deref().unwrap_or_default();
        if let Some(found) = labels.iter().find_map(|label| reference(label)) {
            return Some(found);
        }
        for label in labels {
            let wanted = normalise(label);
            if wanted.is_empty() {
                continue;
            }
            let best = self
                .refs
                .iter()
                .filter_map(|(id, item)| {
                    let priority = ROLE_PRIORITY.iter().position(|role| *role == item.role)?;
                    let name = normalise(&item.name);
                    (!name.is_empty() && name.contains(&wanted)).then_some((name != wanted, priority, name.len(), id))
                })
                .min();
            if let Some((_, _, _, id)) = best {
                return Some(format!("@{id}"));
            }
        }
        None
    }

    /// Where a target is, as a share of the screen, for the agent's cursor.
    pub async fn locate(&self, target: &Target) -> Option<(f64, f64)> {
        let reference = self.resolve(target)?;
        // Measured where it will be clicked: agent-browser scrolls it into
        // view first, so the cursor would otherwise point at the old place.
        let _ = self.run(&["scrollintoview", &reference]).await;
        let found = self.run(&["get", "box", &reference]).await.ok()?;
        let number = |key: &str| found[key].as_f64();
        let (x, y, width, height) = (number("x")?, number("y")?, number("width")?, number("height")?);
        Some((
            ((x + width / 2.0) / self.viewport.0).clamp(0.0, 1.0),
            ((y + height / 2.0) / self.viewport.1).clamp(0.0, 1.0),
        ))
    }

    /// A tool call, answered with a fresh snapshot (or a screenshot).
    pub async fn act(&mut self, action: &Action) -> Result<Value, String> {
        let target = action.target.as_ref();
        let resolved = target.and_then(|target| self.resolve(target));
        let labels: Vec<String> = target.and_then(|t| t.labels.clone()).unwrap_or_default();
        let owned = |parts: &[&str]| parts.iter().map(|part| part.to_string()).collect::<Vec<_>>();
        match action.operation.as_str() {
            "open" => {
                self.run(&["open", action.url.as_deref().ok_or("Missing page URL.")?]).await?;
            }
            "snapshot" => {}
            "click" => {
                let mut commands: Vec<Vec<String>> = resolved.iter().map(|r| owned(&["click", r])).collect();
                for label in labels.iter().filter(|label| reference(label).is_none()) {
                    for role in ROLE_PRIORITY {
                        commands.push(owned(&["find", "role", role, "click", "--name", label]));
                    }
                    commands.push(owned(&["find", "label", label, "click"]));
                    commands.push(owned(&["find", "text", label, "click"]));
                }
                self.first_working(&commands).await?;
            }
            "fill" => {
                let text = action.text.as_deref().ok_or("Missing text.")?;
                let mut commands: Vec<Vec<String>> = resolved.iter().map(|r| owned(&["fill", r, text])).collect();
                for label in labels.iter().filter(|label| reference(label).is_none()) {
                    commands.push(owned(&["find", "label", label, "fill", text]));
                    commands.push(owned(&["find", "placeholder", label, "fill", text]));
                    commands.push(owned(&["find", "role", "textbox", "fill", text, "--name", label]));
                }
                self.first_working(&commands).await?;
            }
            "select" => {
                let values = action.values.as_deref().ok_or("Missing values.")?;
                let mut commands = Vec::new();
                if let Some(r) = &resolved {
                    let mut command = owned(&["select", r]);
                    command.extend(values.iter().cloned());
                    commands.push(command);
                }
                for label in labels.iter().filter(|label| reference(label).is_none()) {
                    let mut command = owned(&["find", "label", label, "select"]);
                    command.extend(values.iter().cloned());
                    commands.push(command);
                }
                self.first_working(&commands).await?;
            }
            "screenshot" => return self.screenshot().await,
            _ => return Err("Unknown browser operation.".into()),
        }
        self.snapshot().await
    }

    async fn screenshot(&self) -> Result<Value, String> {
        let file = self.runtime.join("screenshot.png");
        let path = file.to_str().ok_or("Cannot place the screenshot.")?;
        self.run(&["screenshot", path]).await?;
        let bytes = std::fs::read(&file).map_err(|_| "Screenshot unavailable.")?;
        let _ = std::fs::remove_file(&file);
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        if encoded.len() > MAX_SCREENSHOT_BASE64 {
            return Err("Screenshot exceeds the transfer limit.".into());
        }
        Ok(json!({ "base64": encoded }))
    }
}
