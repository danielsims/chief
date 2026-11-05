//! Browser capacity uses a host-owned Chrome process and empty profile per session.
//! No API accepts a CDP address, executable, filesystem path, or JavaScript from the relay.
use crate::{browser_proxy, host_storage};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::process::{Child, Command};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub enabled: bool,
    pub chrome: PathBuf,
    pub headed: bool,
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
    agent: String,
    directory: PathBuf,
    chrome: Child,
    _proxy: browser_proxy::Proxy,
    cdp: crate::browser_cdp::Cdp,
    last_used: Instant,
}
impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.chrome.start_kill();
        let _ = std::fs::remove_dir_all(&self.directory);
    }
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
            if cfg!(windows) {
                return Err("Browser hosting currently requires Unix process cleanup; Windows support is not enabled.".into());
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
                    headed: args.iter().any(|v| v == "--headed"),
                },
            )?;
            println!("Browser role enabled. It uses new, isolated Chrome profiles and public-only egress. Pair this machine, then run chief-machine serve.");
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
            println!("chief-machine browser enable --chrome <absolute-path> [--headed]\nchief-machine browser disable\nchief-machine browser status\n\nNo personal Chrome profiles, raw CDP attachments, shell, or arbitrary JavaScript are exposed.");
            Ok(())
        }
    }
}

impl Sessions {
    pub fn reap(&mut self) {
        if !enabled() {
            self.sessions.clear();
            return;
        }
        self.sessions
            .retain(|_, s| s.last_used.elapsed() < Duration::from_secs(900));
    }
    pub async fn execute(&mut self, request: Request) -> Value {
        let id = request.request_id.clone();
        let result = tokio::select! {
            result=tokio::time::timeout(Duration::from_secs(55),self.operation(&request))=>result.unwrap_or_else(|_|Err("Browser operation deadline exceeded.".into())),
            _=async{loop{tokio::time::sleep(Duration::from_secs(1)).await;if !enabled(){break;}}}=>Err("Browser role disabled during operation.".into()),
        };
        if result.is_err() {
            // A timed-out/cancelled command must not continue mutating a live page.
            if self
                .sessions
                .get(&request.session_id)
                .is_some_and(|session| session.agent == request.agent_id)
            {
                self.sessions.remove(&request.session_id);
            }
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
            self.sessions.remove(&request.session_id);
            return Ok(json!({"closed":true}));
        }
        if request.operation == "open" && !self.sessions.contains_key(&request.session_id) {
            if self.sessions.len() >= 4 {
                return Err("All four isolated browser slots are occupied. Close a session before opening another.".into());
            }
            let session = launch(&request.session_id, &request.agent_id).await?;
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
            .chrome
            .try_wait()
            .map_err(|_| "Cannot inspect owned browser.")?
            .is_some()
        {
            return Err(
                "Owned Chrome process ended. Close this session and open a fresh one.".into(),
            );
        }
        session.last_used = Instant::now();
        match request.operation.as_str() {
            "open" => {
                let url = request.url.as_deref().ok_or("Missing page URL.")?;
                browser_proxy::destination(url)?;
                session.cdp.navigate(url).await?;
            }
            "snapshot" => {}
            "click" => {
                session
                    .cdp
                    .click(request.target.as_ref().ok_or("Missing target.")?)
                    .await?;
            }
            "fill" => {
                session
                    .cdp
                    .fill(
                        request.target.as_ref().ok_or("Missing target.")?,
                        request.text.as_deref().ok_or("Missing text.")?,
                    )
                    .await?;
            }
            "select" => {
                session
                    .cdp
                    .select(
                        request.target.as_ref().ok_or("Missing target.")?,
                        request.values.as_ref().ok_or("Missing values.")?,
                    )
                    .await?;
            }
            "screenshot" => {
                return session.cdp.screenshot().await;
            }
            _ => return Err("Unknown browser operation.".into()),
        }
        session.cdp.snapshot().await
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

async fn launch(_id: &str, agent: &str) -> Result<Session, String> {
    let settings = settings()?;
    let root = host_storage::root()?.join("browser-sessions");
    host_storage::directory(&root)?;
    let directory = root.join(uuid::Uuid::new_v4().to_string());
    host_storage::directory(&directory)?;
    let profile = directory.join("profile");
    host_storage::directory(&profile)?;
    let proxy = browser_proxy::start().await?;
    let mut command = Command::new(&settings.chrome);
    command
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg("--remote-debugging-port=0")
        .arg("--remote-debugging-address=127.0.0.1")
        .arg(format!("--proxy-server=http://{}", proxy.address))
        .arg("--proxy-bypass-list=<-loopback>")
        .args([
            "--disable-quic",
            "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-component-update",
            "--no-first-run",
            "--no-default-browser-check",
        ])
        .env_clear()
        .env("HOME", &directory)
        .env("TMPDIR", &directory)
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    if settings.headed {
        for key in [
            "DISPLAY",
            "WAYLAND_DISPLAY",
            "XDG_RUNTIME_DIR",
            "XAUTHORITY",
        ] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
    } else {
        command.arg("--headless=new");
    }
    command.arg("about:blank");
    let mut chrome = command
        .spawn()
        .map_err(|_| "Cannot launch isolated Google Chrome.")?;
    let endpoint=tokio::time::timeout(Duration::from_secs(15),async{
        loop{
            if chrome.try_wait().map_err(|_|"Cannot inspect Chrome startup.")?.is_some(){return Err("Chrome exited during startup. Check platform support; sandboxing is never disabled automatically.");}
            if let Ok(text)=std::fs::read_to_string(profile.join("DevToolsActivePort")){
                let mut lines=text.lines();let port=lines.next().and_then(|v|v.parse::<u16>().ok()).ok_or("Invalid Chrome debugging port.")?;
                let path=lines.next().ok_or("Missing Chrome debugging endpoint.")?;
                if !path.starts_with("/devtools/browser/")||path.len()>200||path.contains(['?','#','\r','\n']){return Err("Invalid owned Chrome endpoint.");}
                return Ok(format!("ws://127.0.0.1:{port}{path}"));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }).await.map_err(|_|"Chrome startup deadline exceeded.")?.map_err(String::from)?;
    let cdp = crate::browser_cdp::Cdp::connect(&endpoint).await?;
    Ok(Session {
        agent: agent.into(),
        directory,
        chrome,
        _proxy: proxy,
        cdp,
        last_used: Instant::now(),
    })
}

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

#[cfg(test)]
mod integration_tests {
    use super::*;
    // Explicit opt-in: launches a separate Chrome with a fresh disposable profile.
    #[tokio::test]
    #[ignore = "requires CHIEF_TEST_CHROME"]
    async fn isolated_browser_search_and_private_egress() {
        let root = PathBuf::from(format!("/tmp/chief-host-test-{}", uuid::Uuid::new_v4()));
        std::env::set_var("XDG_CONFIG_HOME", &root);
        host_storage::save(
            &settings_path().unwrap(),
            &Settings {
                enabled: true,
                chrome: std::env::var("CHIEF_TEST_CHROME").unwrap().into(),
                headed: false,
            },
        )
        .unwrap();
        let mut sessions = Sessions::default();
        let id = uuid::Uuid::new_v4().to_string();
        let request = |operation: &str, url: Option<&str>, agent: &str| Request {
            request_id: uuid::Uuid::new_v4().to_string(),
            session_id: id.clone(),
            agent_id: agent.into(),
            operation: operation.into(),
            url: url.map(String::from),
            target: None,
            text: None,
            values: None,
        };
        assert!(sessions
            .operation(&request("snapshot", None, "chief"))
            .await
            .is_err());
        let response = sessions
            .execute(request(
                "open",
                Some("https://www.google.com/search?q=chief+machine"),
                "chief",
            ))
            .await;
        assert_eq!(response["ok"], true, "{response}");
        let opened = &response["output"];
        assert!(opened["url"]
            .as_str()
            .unwrap()
            .starts_with("https://www.google.com/"));
        eprintln!(
            "Google page: {}\n{}",
            opened["title"],
            opened["text"]
                .as_str()
                .unwrap_or("")
                .chars()
                .take(1200)
                .collect::<String>()
        );
        assert!(sessions
            .operation(&request("snapshot", None, "another-agent"))
            .await
            .is_err());
        assert!(sessions
            .operation(&request("open", Some("http://127.0.0.1"), "chief"))
            .await
            .is_err());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        // Test-only script injection: the public protocol does not expose eval.
        // Tries page fetches, images, frames and WebSockets through the browser.
        let script = format!(
            r#"(()=>{{const u='http://127.0.0.1:{port}';fetch(u).catch(()=>{{}});let i=new Image();i.src=u+'/image';document.body.appendChild(i);let f=document.createElement('iframe');f.src=u+'/frame';document.body.appendChild(f);try{{new WebSocket('ws://127.0.0.1:{port}')}}catch(e){{}}return 'attempted';}})()"#
        );
        sessions
            .sessions
            .get_mut(&id)
            .unwrap()
            .cdp
            .test_script(&script)
            .await
            .unwrap();
        assert!(
            tokio::time::timeout(Duration::from_secs(2), listener.accept())
                .await
                .is_err(),
            "private canary must never receive a connection"
        );
        let session = sessions.sessions.get_mut(&id).unwrap();
        session.cdp.test_script("(()=>{let i=document.createElement('input');i.id='chief-test-input';i.setAttribute('aria-label','Chief test input');document.body.append(i);let s=document.createElement('select');s.setAttribute('aria-label','Chief test select');let o=document.createElement('option');o.value='one';o.textContent='One';s.append(o);document.body.append(s);return true})()").await.unwrap();
        session.cdp.snapshot().await.unwrap();
        let input = Target {
            reference: None,
            labels: Some(vec!["Chief test input".into()]),
        };
        session
            .cdp
            .fill(&input, "--cdp is field data")
            .await
            .unwrap();
        assert_eq!(
            session
                .cdp
                .test_script("document.getElementById('chief-test-input').value")
                .await
                .unwrap(),
            json!("--cdp is field data")
        );
        let select = Target {
            reference: None,
            labels: Some(vec!["Chief test select".into()]),
        };
        session.cdp.select(&select, &["one".into()]).await.unwrap();
        session.cdp.click(&input).await.unwrap();
        assert!(
            session.cdp.screenshot().await.unwrap()["base64"]
                .as_str()
                .unwrap()
                .len()
                > 100
        );
        let directory = sessions.sessions.get(&id).unwrap().directory.clone();
        sessions
            .operation(&request("close", None, "chief"))
            .await
            .unwrap();
        assert!(!directory.exists());
        assert!(sessions
            .operation(&request("snapshot", None, "chief"))
            .await
            .is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}
