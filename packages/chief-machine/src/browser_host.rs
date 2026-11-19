//! One browser session's host: `chief-machine browser-host`, started by
//! `browser_launch` for each session. It runs Chrome on a private virtual
//! display, with its own sound server, streams both through the relay, and
//! carries out the agent's actions with agent-browser.
//!
//! Where the kernel allows, the host first moves into its own user, IPC,
//! network and PID namespaces:
//! - the display's framebuffer and Chrome's shared memory can't be opened
//!   from outside the session;
//! - Chrome's DevTools port is on the session's own loopback, which nothing
//!   else on the machine can reach, and Chrome has no network but the
//!   machine's public-web proxy, bridged in over a Unix socket;
//! - everything in the session, agent-browser's daemon included, ends when
//!   the host does.
//!
//! chief-machine reaches the host only through Unix sockets in the session's
//! 0700 directory: `relay.sock` for viewers, `control.sock` for the agent.
//! The X display takes only this session's cookie.

use crate::browser_agent::{Action, AgentBrowser};
use crate::browser_cdp::Link;
use crate::browser_media;
use chief_browser_relay::{AudioConfig, Config, Out, Relay, Role};
use serde_json::{json, Value};
use std::ffi::OsStr;
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{watch, Mutex};

pub const WIDTH: u32 = 1280;
pub const HEIGHT: u32 = 800;

/// The session's sound server: one silent virtual sink, no hardware.
const PIPEWIRE_CONF: &str = r#"
context.properties = {
    core.daemon = true
    core.name = pipewire-0
    module.x11.bell = false
    default.clock.rate = 48000
}
context.spa-libs = {
    audio.convert.* = audioconvert/libspa-audioconvert
    audio.adapt = audioconvert/libspa-audioconvert
    support.* = support/libspa-support
}
context.modules = [
    { name = libpipewire-module-protocol-native }
    { name = libpipewire-module-metadata }
    { name = libpipewire-module-spa-node-factory }
    { name = libpipewire-module-client-node }
    { name = libpipewire-module-access }
    { name = libpipewire-module-adapter }
    { name = libpipewire-module-link-factory }
    { name = libpipewire-module-protocol-pulse }
]
pulse.properties = {
    server.address = [ "unix:native" ]
}
stream.properties = {
    adapter.auto-port-config = { mode = dsp }
}
context.objects = [
    { factory = metadata args = { metadata.name = default } }
    { factory = spa-node-factory
        args = { factory.name = support.node.driver node.name = Dummy-Driver node.group = pipewire.dummy priority.driver = 20000 }
    }
    { factory = adapter
        args = {
            factory.name = support.null-audio-sink
            node.name = "session"
            node.description = "Browser session"
            media.class = "Audio/Sink"
            audio.position = "FL,FR"
            audio.rate = 48000
        }
    }
]
"#;

/// The session's session manager only links Chrome to the virtual sink.
const WIREPLUMBER_CONF: &str = r#"
wireplumber.profiles = {
  main = {
    monitor.alsa = disabled
    monitor.alsa-midi = disabled
    monitor.bluez = disabled
    monitor.bluez-midi = disabled
    monitor.v4l2 = disabled
    monitor.libcamera = disabled
    support.dbus = disabled
    support.portal-permissionstore = disabled
    support.reserve-device = disabled
    support.logind = disabled
  }
}
"#;

struct Args {
    dir: PathBuf,
    chrome: PathBuf,
    agent_browser: PathBuf,
}

fn parse(args: &[String]) -> Result<Args, String> {
    let value = |key: &str| {
        args.iter().position(|a| a == key).and_then(|i| args.get(i + 1)).cloned().ok_or(format!("missing {key}"))
    };
    Ok(Args {
        dir: value("--dir")?.into(),
        chrome: value("--chrome")?.into(),
        agent_browser: value("--agent-browser")?.into(),
    })
}

/// Runs the host until Chrome exits or chief-machine stops it. Status goes to
/// stdout as one line: `ready <isolated|shared> <sound|silent>` or `error <why>`.
pub fn main(args: &[String]) -> ! {
    match run(args) {
        Ok(()) => std::process::exit(0),
        Err(error) => {
            println!("error {error}");
            std::process::exit(1);
        }
    }
}

fn run(args: &[String]) -> Result<(), String> {
    // Everything here dies with chief-machine, and everything after with this.
    die_with_parent();
    let args = parse(args)?;
    check_directory(&args.dir)?;
    let isolated = isolate()?;
    let dir = args.dir.as_path();
    let home = dir.join("home");
    std::fs::create_dir_all(&home).map_err(|_| "cannot create the session home")?;
    let path = std::env::var_os("PATH").unwrap_or_else(|| "/usr/bin:/bin".into());

    // The display takes only this session's cookie.
    let cookie = random_cookie()?;
    let authority = dir.join("Xauthority");
    write_authority(&authority, "", &cookie)?;
    let xvfb_bin = find(&path, "Xvfb").ok_or("Xvfb isn't installed (apt install xvfb)")?;
    let (mut xvfb, display) = start_xvfb(&xvfb_bin, &authority, isolated, &path)?;
    write_authority(&authority, &display.to_string(), &cookie)?;
    let display = format!(":{display}");

    let sound = start_sound(dir, &home, &path);
    let pulse = dir.join("pulse/native");

    // Chrome's only way out: the machine's proxy, over the session's socket.
    let proxy = std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|_| "cannot open the proxy bridge")?;
    let proxy_port = proxy.local_addr().map_err(|e| e.to_string())?.port();
    proxy.set_nonblocking(true).map_err(|e| e.to_string())?;

    let profile = dir.join("profile");
    let mut chrome = command(&args.chrome, &path);
    chrome
        .arg(format!("--user-data-dir={}", profile.display()))
        .args(["--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1"])
        .arg(format!("--proxy-server=http://127.0.0.1:{proxy_port}"))
        .arg("--proxy-bypass-list=<-loopback>")
        .args([
            "--disable-quic",
            "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-component-update",
            "--no-first-run",
            "--no-default-browser-check",
            "--password-store=basic",
            "--noerrdialogs",
            // Software rendering: a virtual display has no GPU.
            "--disable-gpu",
            // The page fills the screen, so the stream is the page.
            "--kiosk",
            "--window-position=0,0",
        ])
        .arg(format!("--window-size={WIDTH},{HEIGHT}"))
        .arg("about:blank")
        .env("HOME", &home)
        .env("TMPDIR", dir)
        .env("DISPLAY", &display)
        .env("XAUTHORITY", &authority);
    if sound.is_some() {
        chrome.env("PULSE_SERVER", format!("unix:{}", pulse.display()));
    }
    let mut chrome = chrome.spawn().map_err(|_| "cannot start Chrome")?;
    let (devtools_port, endpoint) = devtools_endpoint(&profile, &mut chrome)?;

    // SAFETY: still single-threaded; the relay reads XAUTHORITY when it connects.
    std::env::set_var("XAUTHORITY", &authority);
    let mut config = Config::new(display);
    config.xvfb_pid = isolated.then_some(xvfb.id());
    config.audio = sound.as_ref().map(|_| AudioConfig {
        socket: pulse.clone(),
        source: "session.monitor".into(),
        bitrate: 128_000,
    });
    let relay = Arc::new(Relay::start(config)?);
    let viewers = private_socket(&dir.join("relay.sock"))?;
    let control = private_socket(&dir.join("control.sock"))?;
    let agent = AgentBrowser::new(args.agent_browser, devtools_port, dir, path.clone(), (WIDTH, HEIGHT));

    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|e| e.to_string())?;
    let (ended_tx, ended_rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        let _ = chrome.wait();
        let _ = ended_tx.send(());
    });
    let proxy_socket = dir.join("proxy.sock");
    let has_sound = sound.is_some();
    runtime.block_on(async move {
        let devtools = Link::connect(&endpoint).await?;
        let page = attach_page(&devtools).await?;
        let (url_tx, url_rx) = watch::channel(String::new());
        tokio::spawn(follow_url(devtools.clone(), page.clone(), relay.clone(), url_tx));
        println!(
            "ready {} {}",
            if isolated { "isolated" } else { "shared" },
            if has_sound { "sound" } else { "silent" }
        );
        let _ = std::io::stdout().flush();

        let proxy = tokio::net::TcpListener::from_std(proxy).map_err(|e| e.to_string())?;
        let viewers = tokio::net::UnixListener::from_std(viewers).map_err(|e| e.to_string())?;
        let control = tokio::net::UnixListener::from_std(control).map_err(|e| e.to_string())?;
        let agent = Arc::new(Mutex::new(agent));
        let bridge = async {
            loop {
                let Ok((mut stream, _)) = proxy.accept().await else { continue };
                let socket = proxy_socket.clone();
                tokio::spawn(async move {
                    if let Ok(mut machine) = tokio::net::UnixStream::connect(&socket).await {
                        let _ = tokio::io::copy_bidirectional(&mut stream, &mut machine).await;
                    }
                });
            }
        };
        let watch_viewers = async {
            loop {
                let Ok((stream, _)) = viewers.accept().await else { continue };
                let input = Input { devtools: devtools.clone(), page: page.clone() };
                tokio::spawn(view(stream, relay.clone(), input, url_rx.clone()));
            }
        };
        let take_actions = async {
            loop {
                let Ok((stream, _)) = control.accept().await else { continue };
                tokio::spawn(act(stream, agent.clone()));
            }
        };
        tokio::select! {
            _ = bridge => {}
            _ = watch_viewers => {}
            _ = take_actions => {}
            _ = ended_rx => {}
        }
        Ok::<(), String>(())
    })?;
    let _ = xvfb.kill();
    if let Some(mut sound) = sound {
        for process in sound.iter_mut() {
            let _ = process.kill();
        }
    }
    Ok(())
}

/// A Unix socket only this user can open.
fn private_socket(path: &Path) -> Result<std::os::unix::net::UnixListener, String> {
    let _ = std::fs::remove_file(path);
    let listener = std::os::unix::net::UnixListener::bind(path).map_err(|_| "cannot open a session socket")?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).map_err(|_| "cannot protect a session socket")?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    Ok(listener)
}

/// Chrome's DevTools port and browser endpoint, from the file it writes.
fn devtools_endpoint(profile: &Path, chrome: &mut Child) -> Result<(u16, String), String> {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if matches!(chrome.try_wait(), Ok(Some(_))) {
            return Err("Chrome exited during startup; sandboxing is never disabled automatically".into());
        }
        if let Ok(text) = std::fs::read_to_string(profile.join("DevToolsActivePort")) {
            let mut lines = text.lines();
            if let (Some(port), Some(path)) = (lines.next().and_then(|p| p.parse::<u16>().ok()), lines.next()) {
                if !path.starts_with("/devtools/browser/") || path.len() > 200 || path.contains(['?', '#']) {
                    return Err("Chrome reported an unexpected DevTools endpoint".into());
                }
                return Ok((port, format!("ws://127.0.0.1:{port}{path}")));
            }
        }
        if Instant::now() > deadline {
            return Err("Chrome didn't start in time".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// The page Chrome shows in its kiosk window, attached for input and URLs.
async fn attach_page(devtools: &Link) -> Result<String, String> {
    let targets = devtools.call("Target.getTargets", json!({}), None).await?;
    let target = targets["targetInfos"]
        .as_array()
        .and_then(|targets| targets.iter().find(|t| t["type"] == "page"))
        .and_then(|t| t["targetId"].as_str())
        .ok_or("Chrome has no page")?
        .to_string();
    let attached = devtools
        .call("Target.attachToTarget", json!({"targetId": target, "flatten": true}), None)
        .await?;
    let session = attached["sessionId"].as_str().ok_or("Cannot attach to the page")?.to_string();
    devtools.call("Page.enable", json!({}), Some(&session)).await?;
    Ok(session)
}

/// Tells viewers where the page is, now and on each navigation.
async fn follow_url(devtools: Arc<Link>, page: String, relay: Arc<Relay>, latest: watch::Sender<String>) {
    let mut events = devtools.events();
    loop {
        let event = match events.recv().await {
            Ok(event) => event,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
        };
        if event["sessionId"].as_str() != Some(page.as_str())
            || event["method"] != "Page.frameNavigated"
            || !event["params"]["frame"]["parentId"].is_null()
        {
            continue;
        }
        let message = json!({"type": "url", "url": event["params"]["frame"]["url"]}).to_string();
        relay.broadcast(&message);
        let _ = latest.send(message);
    }
}

/// One agent action: a request frame in, an answer frame out.
async fn act(stream: tokio::net::UnixStream, agent: Arc<Mutex<AgentBrowser>>) {
    let (input, mut output) = stream.into_split();
    let mut frames = browser_media::frames(input);
    let Some(Ok((browser_media::TEXT, request))) = frames.recv().await else { return };
    let answer = match serde_json::from_slice::<Action>(&request) {
        Ok(action) if action.operation == "locate" => {
            let cursor = match &action.target {
                Some(target) => agent.lock().await.locate(target).await,
                None => None,
            };
            json!({"ok": true, "output": cursor.map(|(x, y)| json!({"x": x, "y": y}))})
        }
        Ok(action) => match agent.lock().await.act(&action).await {
            Ok(output) => json!({"ok": true, "output": output}),
            Err(error) => json!({"ok": false, "error": error}),
        },
        Err(_) => json!({"ok": false, "error": "Invalid browser action."}),
    };
    let _ = browser_media::write(&mut output, browser_media::TEXT, answer.to_string().as_bytes()).await;
}

/// Where a viewer's input goes: the page, over the host's own connection.
struct Input {
    devtools: Arc<Link>,
    page: String,
}

/// One viewer: its role byte, then relay output out and viewer commands
/// and (for the controller) input in.
async fn view(stream: tokio::net::UnixStream, relay: Arc<Relay>, input: Input, url: watch::Receiver<String>) {
    use tokio::io::AsyncReadExt;
    let (mut reader, mut output) = stream.into_split();
    let role = match reader.read_u8().await {
        Ok(browser_media::ROLE_CONTROL) => Role::Control,
        Ok(browser_media::ROLE_WATCH) => Role::Watch,
        _ => return,
    };
    let mut viewer = relay.join(role);
    let current = url.borrow().clone();
    if !current.is_empty() && browser_media::write(&mut output, browser_media::TEXT, current.as_bytes()).await.is_err() {
        return;
    }
    let mut frames = browser_media::frames(reader);
    let mut touching = false;
    // A touch's time on the viewer, against Chrome's clock, so fling speed
    // follows the finger rather than the network's timing.
    let mut touch_clock: Option<(f64, f64)> = None;
    loop {
        tokio::select! {
            out = viewer.next() => {
                let sent = match out {
                    Some(Out::Binary(bytes)) => browser_media::write(&mut output, browser_media::BINARY, &bytes).await,
                    Some(Out::Text(text)) => browser_media::write(&mut output, browser_media::TEXT, text.as_bytes()).await,
                    None => break,
                };
                if sent.is_err() {
                    break;
                }
            }
            frame = frames.recv() => {
                let Some(Ok((browser_media::TEXT, text))) = frame else { break };
                let Ok(text) = std::str::from_utf8(&text) else { continue };
                if !text.starts_with('{') {
                    viewer.receive(text);
                    continue;
                }
                if role != Role::Control {
                    continue;
                }
                let Some((method, mut params)) = parse_input(text) else { continue };
                if let Some(at) = params.as_object_mut().and_then(|params| params.remove("viewerTimestamp")).and_then(|at| at.as_f64()) {
                    let now = now_ms();
                    let (viewer_start, chrome_start) = match (touch_clock, params["type"].as_str()) {
                        (Some(clock), Some(phase)) if phase != "touchStart" => clock,
                        _ => (at, now),
                    };
                    touch_clock = Some((viewer_start, chrome_start));
                    // Seconds, as Chrome's TimeSinceEpoch; never ahead of now.
                    params["timestamp"] = json!((chrome_start + (at - viewer_start)).min(now) / 1000.0);
                }
                // The first touch puts the page in touch mode, so Chrome
                // scrolls and flings it natively.
                if method == "Input.dispatchTouchEvent" && !touching {
                    touching = true;
                    input.devtools.send("Emulation.setTouchEmulationEnabled", json!({"enabled": true, "maxTouchPoints": 1}), Some(&input.page));
                }
                if !input.devtools.send(method, params, Some(&input.page)) {
                    break;
                }
            }
        }
    }
    if touching {
        input.devtools.send("Emulation.setTouchEmulationEnabled", json!({"enabled": false}), Some(&input.page));
    }
}

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as f64)
        .unwrap_or(0.0)
}

/// A viewer's click, touch or key as the DevTools command that replays it.
/// Only mouse, touch and keyboard input is accepted; nothing else reaches the
/// browser.
fn parse_input(text: &str) -> Option<(&'static str, Value)> {
    let value: Value = serde_json::from_str(text).ok()?;
    let event_type = value["eventType"].as_str()?;
    match value["type"].as_str()? {
        "input_mouse" if matches!(event_type, "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel") => Some((
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
        )),
        "input_touch" if matches!(event_type, "touchStart" | "touchMove" | "touchEnd" | "touchCancel") => {
            let points = if matches!(event_type, "touchEnd" | "touchCancel") {
                json!([])
            } else {
                json!([{"x": value["x"].as_f64()?, "y": value["y"].as_f64()?}])
            };
            let mut params = json!({"type": event_type, "touchPoints": points});
            if let Some(at) = value["timestamp"].as_f64() {
                params["viewerTimestamp"] = json!(at);
            }
            Some(("Input.dispatchTouchEvent", params))
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

/// In a child between fork and exec: puts each fd at its target number,
/// inheritable, whatever numbers they started at. Only async-signal-safe calls.
pub fn place_fds(moves: &[(RawFd, RawFd)]) -> std::io::Result<()> {
    let mut staged = [-1; 4];
    for (i, &(fd, _)) in moves.iter().enumerate() {
        // Above any target first, so no move overwrites another's source.
        staged[i] = unsafe { libc::fcntl(fd, libc::F_DUPFD_CLOEXEC, 10) };
        if staged[i] < 0 {
            return Err(std::io::Error::last_os_error());
        }
    }
    for (i, &(_, target)) in moves.iter().enumerate() {
        if unsafe { libc::dup2(staged[i], target) } < 0 {
            return Err(std::io::Error::last_os_error());
        }
    }
    Ok(())
}

fn die_with_parent() {
    unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) };
}

/// The session directory chief-machine made: ours, private, under /tmp.
fn check_directory(dir: &Path) -> Result<(), String> {
    let name = dir.file_name().and_then(OsStr::to_str).unwrap_or_default();
    let metadata = std::fs::symlink_metadata(dir).map_err(|_| "no session directory")?;
    if dir.parent() != Some(Path::new("/tmp"))
        || !name.starts_with(crate::browser::SESSION_PREFIX)
        || !metadata.is_dir()
        || metadata.uid() != unsafe { libc::getuid() }
        || metadata.mode() & 0o777 != 0o700
    {
        return Err("the session directory isn't private".into());
    }
    Ok(())
}

/// New user, IPC, network and PID namespaces, mapping only our own user.
/// The process carries on as the namespace's first process (a child, as a
/// PID namespace takes effect for children); this one waits and passes on
/// its exit. False where the kernel or a container doesn't allow them; the
/// session then shares the machine's.
fn isolate() -> Result<bool, String> {
    let (uid, gid) = unsafe { (libc::getuid(), libc::getgid()) };
    let flags = libc::CLONE_NEWUSER | libc::CLONE_NEWIPC | libc::CLONE_NEWNET | libc::CLONE_NEWPID;
    if unsafe { libc::unshare(flags) } != 0 {
        return Ok(false);
    }
    let write = |path: &str, text: String| std::fs::write(path, text).is_ok();
    // Without these the namespace has no users at all; nothing would run.
    if !(write("/proc/self/setgroups", "deny".into())
        && write("/proc/self/uid_map", format!("{uid} {uid} 1"))
        && write("/proc/self/gid_map", format!("{gid} {gid} 1")))
    {
        return Err("cannot map the session's user".into());
    }
    let _ = std::io::stdout().flush();
    match unsafe { libc::fork() } {
        -1 => Err("cannot start the session".into()),
        0 => {
            die_with_parent();
            loopback_up()?;
            Ok(true)
        }
        child => {
            let mut status = 0;
            unsafe { libc::waitpid(child, &mut status, 0) };
            let code = if libc::WIFEXITED(status) { libc::WEXITSTATUS(status) } else { 1 };
            std::process::exit(code);
        }
    }
}

/// A new network namespace starts with loopback down.
fn loopback_up() -> Result<(), String> {
    unsafe {
        let socket = libc::socket(libc::AF_INET, libc::SOCK_DGRAM, 0);
        if socket < 0 {
            return Err("cannot configure the session's network".into());
        }
        let mut request: libc::ifreq = std::mem::zeroed();
        for (slot, byte) in request.ifr_name.iter_mut().zip(b"lo\0") {
            *slot = *byte as libc::c_char;
        }
        let ok = libc::ioctl(socket, libc::SIOCGIFFLAGS as _, &mut request) == 0 && {
            request.ifr_ifru.ifru_flags |= libc::IFF_UP as libc::c_short;
            libc::ioctl(socket, libc::SIOCSIFFLAGS as _, &request) == 0
        };
        libc::close(socket);
        ok.then_some(()).ok_or("cannot bring up the session's loopback".into())
    }
}

fn random_cookie() -> Result<[u8; 16], String> {
    let mut cookie = [0u8; 16];
    let filled = unsafe { libc::getrandom(cookie.as_mut_ptr().cast(), cookie.len(), 0) };
    if filled != cookie.len() as isize {
        return Err("no randomness for the display cookie".into());
    }
    Ok(cookie)
}

/// An Xauthority file with one cookie for any host. `display` is the number,
/// or empty before Xvfb has picked one (the server reads every entry).
fn write_authority(path: &Path, display: &str, cookie: &[u8; 16]) -> Result<(), String> {
    let mut entry = Vec::new();
    let field = |entry: &mut Vec<u8>, bytes: &[u8]| {
        entry.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
        entry.extend_from_slice(bytes);
    };
    entry.extend_from_slice(&0xffffu16.to_be_bytes());
    field(&mut entry, b"");
    field(&mut entry, display.as_bytes());
    field(&mut entry, b"MIT-MAGIC-COOKIE-1");
    field(&mut entry, cookie);
    let staging = path.with_extension("new");
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&staging)
        .map_err(|_| "cannot write the display cookie")?;
    file.write_all(&entry).map_err(|_| "cannot write the display cookie")?;
    std::fs::rename(&staging, path).map_err(|_| "cannot write the display cookie".into())
}

fn find(path: &OsStr, name: &str) -> Option<PathBuf> {
    std::env::split_paths(path).map(|dir| dir.join(name)).find(|candidate| candidate.is_file())
}

/// A child that gets a clean environment and dies with this host.
fn command(program: &Path, path: &OsStr) -> Command {
    let mut command = Command::new(program);
    command.env_clear().env("PATH", path).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    unsafe {
        command.pre_exec(|| {
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
            Ok(())
        });
    }
    command
}

/// Xvfb on the first free display, which it reports on a pipe once it's ready.
fn start_xvfb(program: &Path, authority: &Path, isolated: bool, path: &OsStr) -> Result<(Child, u32), String> {
    let mut fds = [0; 2];
    if unsafe { libc::pipe2(fds.as_mut_ptr(), libc::O_CLOEXEC) } != 0 {
        return Err("cannot start the display".into());
    }
    let (read, write) = unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) };
    let mut xvfb = command(program, path);
    xvfb.args(["-displayfd", "3", "-screen", "0"])
        .arg(format!("{WIDTH}x{HEIGHT}x24"))
        // Viewers see the agent's cursor drawn over the stream, not X's.
        .args(["-nocursor", "-nolisten", "tcp", "-auth"])
        .arg(authority);
    // Its framebuffer in shared memory is read in place, but only where no
    // other process can open that memory.
    if isolated {
        xvfb.arg("-shmem");
    }
    let raw_write = write.as_raw_fd();
    unsafe {
        xvfb.pre_exec(move || place_fds(&[(raw_write, 3)]));
    }
    let mut child = xvfb.spawn().map_err(|_| "cannot start Xvfb")?;
    drop(write);
    let mut reader = std::fs::File::from(read);
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut text = String::new();
    let mut byte = [0u8; 1];
    while !text.ends_with('\n') {
        if Instant::now() > deadline || matches!(child.try_wait(), Ok(Some(_))) {
            let _ = child.kill();
            return Err("Xvfb didn't start".into());
        }
        match reader.read(&mut byte) {
            Ok(1) => text.push(byte[0] as char),
            _ => {
                let _ = child.kill();
                return Err("Xvfb didn't start".into());
            }
        }
    }
    let display = text.trim().parse().map_err(|_| "Xvfb reported no display")?;
    Ok((child, display))
}

/// PipeWire and WirePlumber for this session alone, or None when they aren't
/// installed or don't come up; the session is then silent.
fn start_sound(dir: &Path, home: &Path, path: &OsStr) -> Option<Vec<Child>> {
    let pipewire = find(path, "pipewire")?;
    let wireplumber = find(path, "wireplumber")?;
    let conf = dir.join("pipewire.conf");
    let wp_dir = dir.join("config/wireplumber/wireplumber.conf.d");
    std::fs::write(&conf, PIPEWIRE_CONF).ok()?;
    std::fs::create_dir_all(&wp_dir).ok()?;
    std::fs::write(wp_dir.join("90-session.conf"), WIREPLUMBER_CONF).ok()?;
    let environment = |command: &mut Command| {
        command
            .env("HOME", home)
            .env("XDG_RUNTIME_DIR", dir)
            .env("XDG_CONFIG_HOME", dir.join("config"));
    };
    let mut server = command(&pipewire, path);
    server.arg("-c").arg(&conf);
    environment(&mut server);
    let mut server = server.spawn().ok()?;
    let socket = dir.join("pulse/native");
    let deadline = Instant::now() + Duration::from_secs(5);
    while !socket.exists() {
        if Instant::now() > deadline || matches!(server.try_wait(), Ok(Some(_))) {
            let _ = server.kill();
            return None;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let mut manager = command(&wireplumber, path);
    environment(&mut manager);
    match manager.spawn() {
        Ok(manager) => Some(vec![server, manager]),
        Err(_) => {
            let _ = server.kill();
            None
        }
    }
}
