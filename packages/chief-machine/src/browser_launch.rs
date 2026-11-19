//! Starting a browser session on Linux: its private directory and egress
//! proxy, then the session host (`browser_host`), which reports when Chrome,
//! its display and sound, agent-browser and the relay are up.
use crate::browser::{settings, Session, SESSION_PREFIX};
use crate::browser_proxy;
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::AsyncBufReadExt;
use tokio::process::Command;

/// Stops a session host that never became a session.
struct Starting(Option<u32>);
impl Drop for Starting {
    fn drop(&mut self) {
        if let Some(pid) = self.0 {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
        }
    }
}

pub async fn launch(agent: &str) -> Result<Session, String> {
    let settings = settings()?;
    // A short base path: the session's sockets live in it.
    let mut temporary = tempfile::Builder::new();
    temporary.prefix(SESSION_PREFIX).rand_bytes(6);
    {
        use std::os::unix::fs::PermissionsExt;
        temporary.permissions(std::fs::Permissions::from_mode(0o700));
    }
    let directory = temporary
        .tempdir_in("/tmp")
        .map_err(|_| "Cannot create a private Chrome session directory.")?;
    let proxy = browser_proxy::start(&directory.path().join("proxy.sock")).await?;
    let executable = std::env::current_exe().map_err(|_| "Cannot find chief-machine.")?;
    let agent_browser = agent_browser(&executable)?;
    let mut command = Command::new(&executable);
    command
        .arg("browser-host")
        .arg("--dir")
        .arg(directory.path())
        .arg("--chrome")
        .arg(&settings.chrome)
        .arg("--agent-browser")
        .arg(agent_browser)
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        // Its own process group, so ending the session ends everything in it.
        .process_group(0);
    let mut host = command
        .spawn()
        .map_err(|_| "Cannot start the browser session.")?;
    // Until it's a session, a host that fails to start is stopped here.
    let mut starting = Starting(host.id());
    let stdout = host.stdout.take().ok_or("Cannot read the browser session's status.")?;
    let mut lines = tokio::io::BufReader::new(stdout).lines();
    let status = tokio::time::timeout(Duration::from_secs(20), lines.next_line())
        .await
        .map_err(|_| "Browser session startup deadline exceeded.")?
        .ok()
        .flatten()
        .ok_or("The browser session ended during startup. Check that Chrome and Xvfb are installed; sandboxing is never disabled automatically.")?;
    let mut words = status.split_whitespace();
    match words.next() {
        Some("ready") => {
            if words.next() == Some("shared") {
                eprintln!("browser session: this machine doesn't allow user namespaces, so the session shares the machine's IPC namespace and network");
            }
        }
        _ => {
            let reason = status.strip_prefix("error ").unwrap_or("unknown failure");
            return Err(format!("The browser session couldn't start: {reason}."));
        }
    }
    starting.0 = None;
    Ok(Session {
        agent: agent.into(),
        host,
        directory: Some(directory),
        _proxy: proxy,
        activity: tokio::sync::broadcast::channel(16).0,
        activity_sequence: 0,
        last_used: Instant::now(),
    })
}

/// agent-browser, installed beside chief-machine or on the PATH.
fn agent_browser(executable: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let beside = executable.with_file_name("agent-browser");
    if beside.is_file() {
        return Ok(beside);
    }
    std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .map(|dir| dir.join("agent-browser"))
        .find(|candidate| candidate.is_file())
        .ok_or("agent-browser isn't installed beside chief-machine. Run the machine installer again.".into())
}

/// One action for a session's host, over its control socket; the host's
/// output, or its error.
pub async fn request(directory: &std::path::Path, action: serde_json::Value) -> Result<serde_json::Value, String> {
    use crate::browser_media;
    let mut stream = tokio::net::UnixStream::connect(directory.join("control.sock"))
        .await
        .map_err(|_| "The browser session isn't answering.")?;
    browser_media::write(&mut stream, browser_media::TEXT, action.to_string().as_bytes())
        .await
        .map_err(|_| "The browser session isn't answering.")?;
    let (_, answer) = browser_media::read(&mut stream)
        .await
        .map_err(|_| "The browser session ended during the action.")?;
    let answer: serde_json::Value = serde_json::from_slice(&answer).map_err(|_| "Invalid browser session answer.")?;
    if answer["ok"] == true {
        Ok(answer["output"].clone())
    } else {
        Err(answer["error"].as_str().unwrap_or("The browser action failed.").to_string())
    }
}
