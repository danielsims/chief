use std::{
    env,
    fs::OpenOptions,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

struct RuntimeProcess {
    stop: Arc<AtomicBool>,
    supervisor: Mutex<Option<JoinHandle<()>>>,
}

const RUNTIME_PORT: u16 = 4318;
const RUNTIME_PROTOCOL: &str = "2";

#[derive(Default)]
struct PendingNotificationActivation(Mutex<Option<serde_json::Value>>);

impl PendingNotificationActivation {
    fn take(&self) -> Option<serde_json::Value> {
        self.0.lock().ok()?.take()
    }
}

fn terminate_runtime(child: &mut Child) {
    #[cfg(unix)]
    {
        let process_group = format!("-{}", child.id());
        let _ = Command::new("/bin/kill")
            .args(["-TERM", &process_group])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        let _ = Command::new("/bin/kill")
            .args(["-KILL", &process_group])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

impl RuntimeProcess {
    fn start(app: tauri::AppHandle) -> Self {
        terminate_recorded_runtime(&app);
        terminate_unrecognized_runtime_on_port();

        let stop = Arc::new(AtomicBool::new(false));
        let supervisor_stop = Arc::clone(&stop);
        let supervisor = thread::spawn(move || {
            let mut child: Option<Child> = None;
            let mut unhealthy_since: Option<Instant> = None;
            let mut healthy_since: Option<Instant> = None;
            let mut has_been_healthy = false;
            let mut restart_delay = Duration::from_secs(1);
            let mut next_spawn_at = Instant::now();

            while !supervisor_stop.load(Ordering::Relaxed) {
                let now = Instant::now();
                if let Some(runtime) = child.as_mut() {
                    match runtime.try_wait() {
                        Ok(Some(status)) => {
                            eprintln!("[runtime] agent runtime exited with {status}; restarting");
                            child = None;
                            unhealthy_since = None;
                            healthy_since = None;
                            has_been_healthy = false;
                            next_spawn_at = restart_at(&mut restart_delay);
                        }
                        Ok(None) => {
                            if runtime_is_running() {
                                has_been_healthy = true;
                                unhealthy_since = None;
                                let became_healthy = healthy_since.get_or_insert(now);
                                if became_healthy.elapsed() >= Duration::from_secs(30) {
                                    restart_delay = Duration::from_secs(1);
                                }
                            } else {
                                healthy_since = None;
                                let became_unhealthy = unhealthy_since.get_or_insert(now);
                                let grace = if has_been_healthy {
                                    Duration::from_secs(3)
                                } else {
                                    Duration::from_secs(20)
                                };
                                if became_unhealthy.elapsed() >= grace {
                                    eprintln!("[runtime] agent runtime is unhealthy; restarting");
                                    terminate_runtime(runtime);
                                    child = None;
                                    unhealthy_since = None;
                                    has_been_healthy = false;
                                    next_spawn_at = restart_at(&mut restart_delay);
                                }
                            }
                        }
                        Err(error) => {
                            eprintln!(
                                "[runtime] could not inspect agent runtime: {error}; restarting"
                            );
                            terminate_runtime(runtime);
                            child = None;
                            unhealthy_since = None;
                            healthy_since = None;
                            has_been_healthy = false;
                            next_spawn_at = restart_at(&mut restart_delay);
                        }
                    }
                } else if runtime_is_running() {
                    // A developer-run runtime may already own the port. Leave it
                    // alone while healthy, but take over if it later disappears.
                    restart_delay = Duration::from_secs(1);
                    next_spawn_at = now;
                } else if runtime_port_is_open() {
                    if now >= next_spawn_at {
                        if terminate_unrecognized_runtime_on_port() {
                            next_spawn_at = now + Duration::from_millis(500);
                        } else {
                            eprintln!(
                                "[runtime] port {RUNTIME_PORT} is owned by another process; waiting"
                            );
                            next_spawn_at = restart_at(&mut restart_delay);
                        }
                    }
                } else if now >= next_spawn_at {
                    child = spawn_agent_runtime(&app);
                    if child.is_some() {
                        if let Some(runtime) = child.as_ref() {
                            record_runtime_process(&app, runtime.id());
                        }
                        unhealthy_since = Some(now);
                        healthy_since = None;
                        has_been_healthy = false;
                    } else {
                        next_spawn_at = restart_at(&mut restart_delay);
                    }
                }

                thread::sleep(Duration::from_millis(500));
            }

            if let Some(runtime) = child.as_mut() {
                terminate_runtime(runtime);
            }
        });

        Self {
            stop,
            supervisor: Mutex::new(Some(supervisor)),
        }
    }

    fn shutdown(&self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Ok(mut supervisor) = self.supervisor.lock() {
            if let Some(handle) = supervisor.take() {
                let _ = handle.join();
            }
        }
    }
}

fn runtime_process_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;

    Some(
        app.path()
            .app_local_data_dir()
            .ok()?
            .join("agent-runtime.pid"),
    )
}

fn process_command(pid: u32) -> Option<String> {
    #[cfg(unix)]
    {
        let output = Command::new("/bin/ps")
            .args(["-p", &pid.to_string(), "-o", "command="])
            .output()
            .ok()?;
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    #[cfg(windows)]
    {
        let output = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .output()
            .ok()?;
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

fn command_runs_executable(command: &str, executable: &Path) -> bool {
    let expected = executable.to_string_lossy();
    command == expected || command.starts_with(&format!("{expected} "))
}

fn process_is_current_app(pid: u32) -> bool {
    let Some(executable) = env::current_exe().ok() else {
        return false;
    };
    process_command(pid).is_some_and(|command| command_runs_executable(&command, &executable))
}

fn is_chief_runtime_command(command: &str) -> bool {
    command.contains("chief-agent-runtime")
        || command.contains("@chief/agent-runtime")
        || (command.contains("packages/agent-runtime") && command.contains("tsx"))
}

fn terminate_recorded_runtime(app: &tauri::AppHandle) {
    let Some(path) = runtime_process_file(app) else {
        return;
    };
    let Some(contents) = std::fs::read_to_string(&path).ok() else {
        return;
    };
    let mut fields = contents.split_whitespace();
    let owner_pid = fields.next().and_then(|value| value.parse::<u32>().ok());
    let runtime_pid = fields.next().and_then(|value| value.parse::<u32>().ok());
    let Some(runtime_pid) = runtime_pid else {
        let _ = std::fs::remove_file(path);
        return;
    };

    // A second launch should never tear down the runtime owned by a healthy
    // first app instance. Only reap a process whose owning app has exited.
    if owner_pid
        .filter(|pid| *pid != std::process::id())
        .is_some_and(process_is_current_app)
    {
        return;
    }

    let is_chief_runtime = process_command(runtime_pid)
        .map(|command| is_chief_runtime_command(&command))
        .unwrap_or(false);
    if is_chief_runtime {
        #[cfg(unix)]
        let _ = Command::new("/bin/kill")
            .args(["-TERM", &format!("-{runtime_pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        #[cfg(windows)]
        let _ = Command::new("taskkill")
            .args(["/PID", &runtime_pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        for _ in 0..20 {
            if !runtime_is_running() {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
    }
    let _ = std::fs::remove_file(path);
}

fn record_runtime_process(app: &tauri::AppHandle, runtime_pid: u32) {
    let Some(path) = runtime_process_file(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, format!("{} {runtime_pid}\n", std::process::id()));
}

fn restart_at(delay: &mut Duration) -> Instant {
    let jitter_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::from(duration.subsec_millis()) % 500)
        .unwrap_or(0);
    let next = Instant::now() + *delay + Duration::from_millis(jitter_ms);
    *delay = delay.saturating_mul(2).min(Duration::from_secs(30));
    next
}

fn runtime_port_is_open() -> bool {
    let addr: SocketAddr = format!("127.0.0.1:{RUNTIME_PORT}")
        .parse()
        .expect("valid local runtime socket address");
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

#[cfg(unix)]
fn runtime_listener_pids() -> Vec<u32> {
    let args = [
        "-nP".to_string(),
        format!("-iTCP:{RUNTIME_PORT}"),
        "-sTCP:LISTEN".to_string(),
        "-t".to_string(),
    ];
    let output = ["/usr/sbin/lsof", "/usr/bin/lsof", "lsof"]
        .into_iter()
        .find_map(|executable| Command::new(executable).args(&args).output().ok());
    let Some(output) = output else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect()
}

#[cfg(windows)]
fn runtime_listener_pids() -> Vec<u32> {
    Vec::new()
}

fn terminate_unrecognized_runtime_on_port() -> bool {
    if !runtime_port_is_open() || runtime_is_running() {
        return false;
    }
    let mut terminated = false;
    for pid in runtime_listener_pids() {
        let is_chief_runtime = process_command(pid)
            .map(|command| is_chief_runtime_command(&command))
            .unwrap_or(false);
        if !is_chief_runtime {
            continue;
        }
        eprintln!("[runtime] replacing incompatible Chief runtime {pid}");
        #[cfg(unix)]
        let _ = Command::new("/bin/kill")
            .args(["-TERM", &format!("-{pid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        #[cfg(windows)]
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        terminated = true;
    }
    terminated
}

impl Drop for RuntimeProcess {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn runtime_is_running() -> bool {
    let addr: SocketAddr = format!("127.0.0.1:{RUNTIME_PORT}")
        .parse()
        .expect("valid local runtime socket address");
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(250)) else {
        return false;
    };
    let timeout = Some(Duration::from_millis(500));
    let _ = stream.set_read_timeout(timeout);
    let _ = stream.set_write_timeout(timeout);
    if stream
        .write_all(b"GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut response = Vec::with_capacity(512);
    while response.len() < 512 && !response.windows(4).any(|part| part == b"\r\n\r\n") {
        let mut chunk = [0_u8; 128];
        let Ok(length) = stream.read(&mut chunk) else {
            return false;
        };
        if length == 0 {
            break;
        }
        response.extend_from_slice(&chunk[..length]);
    }
    is_runtime_health_response(&response)
}

fn is_runtime_health_response(response: &[u8]) -> bool {
    let text = String::from_utf8_lossy(response);
    let Some((headers, _body)) = text.split_once("\r\n\r\n") else {
        return false;
    };
    let mut lines = headers.lines();
    let ready_status = lines
        .next()
        .is_some_and(|status| status.starts_with("HTTP/1.1 200"));
    let mut chief_ready = false;
    let mut protocol_matches = false;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("x-chief-runtime") && value.trim() == "ready" {
                chief_ready = true;
            }
            if name.eq_ignore_ascii_case("x-chief-runtime-protocol")
                && value.trim() == RUNTIME_PROTOCOL
            {
                protocol_matches = true;
            }
        }
    }
    ready_status && chief_ready && protocol_matches
}

#[cfg(test)]
mod runtime_health_tests {
    use std::path::Path;

    use super::{command_runs_executable, is_runtime_health_response};

    #[test]
    fn accepts_only_the_ready_chief_runtime() {
        assert!(is_runtime_health_response(
            b"HTTP/1.1 200 OK\r\nx-chief-runtime: ready\r\nx-chief-runtime-protocol: 2\r\n\r\nchief-runtime-ready"
        ));
        assert!(!is_runtime_health_response(b"HTTP/1.1 200 OK\r\n\r\n"));
        assert!(!is_runtime_health_response(
            b"HTTP/1.1 503 Service Unavailable\r\nx-chief-runtime: ready\r\nx-chief-runtime-protocol: 2\r\n\r\n"
        ));
        assert!(!is_runtime_health_response(
            b"HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\n\r\nx-chief-runtime: ready\nx-chief-runtime-protocol: 2"
        ));
        assert!(!is_runtime_health_response(
            b"HTTP/1.1 200 OK\r\nx-chief-runtime: ready\r\n\r\n"
        ));
    }

    #[test]
    fn matches_the_recorded_owner_to_the_exact_app_executable() {
        let executable = Path::new("/Applications/Chief.app/Contents/MacOS/desktop");
        assert!(command_runs_executable(
            "/Applications/Chief.app/Contents/MacOS/desktop",
            executable
        ));
        assert!(!command_runs_executable(
            "/Applications/Codex.app/Contents/MacOS/Codex",
            executable
        ));
    }
}

#[cfg(debug_assertions)]
fn spawn_agent_runtime(_app: &tauri::AppHandle) -> Option<Child> {
    let default_repo_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .ok()
        .and_then(|path| path.to_str().map(ToOwned::to_owned));
    let repo_dir = std::env::var("CHIEF_REPO_DIR").ok().or(default_repo_dir)?;
    if !Path::new(&repo_dir).exists() {
        eprintln!("[runtime] repo directory not found: {repo_dir}");
        return None;
    }

    let node_binary = find_node_binary(Path::new(&repo_dir));
    let mut path_entries = node_binary
        .as_ref()
        .and_then(|node| node.parent())
        .map(Path::to_path_buf)
        .into_iter()
        .collect::<Vec<_>>();
    path_entries.extend(
        ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
            .into_iter()
            .map(PathBuf::from),
    );
    if let Some(current_path) = env::var_os("PATH") {
        path_entries.extend(env::split_paths(&current_path));
    }
    let path = env::join_paths(path_entries).ok()?;

    let mut candidates: Vec<(PathBuf, Vec<&str>)> = vec![
        (
            PathBuf::from("/opt/homebrew/bin/corepack"),
            vec!["pnpm", "--filter", "@chief/agent-runtime", "dev"],
        ),
        (
            PathBuf::from("corepack"),
            vec!["pnpm", "--filter", "@chief/agent-runtime", "dev"],
        ),
        (
            PathBuf::from("/opt/homebrew/bin/pnpm"),
            vec!["--filter", "@chief/agent-runtime", "dev"],
        ),
    ];
    if let Some(home) = env::var_os("HOME") {
        candidates.push((
            PathBuf::from(home).join("Library/pnpm/pnpm"),
            vec!["--filter", "@chief/agent-runtime", "dev"],
        ));
    }

    // Only attempt binaries that actually exist. Trying a missing absolute path
    // (e.g. /opt/homebrew/bin/corepack on machines where corepack lives in the
    // Node install) surfaces a noisy ENOENT before the loop reaches a working
    // candidate, and a bare "corepack" on PATH is resolved lazily at spawn.
    candidates.retain(|(program, _)| {
        program.is_absolute()
            .then(|| program.is_file())
            .unwrap_or(true)
    });

    for (program, args) in candidates {
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open("/tmp/chief-agent-runtime.log");
        let stdout = log
            .as_ref()
            .ok()
            .and_then(|file| file.try_clone().ok())
            .map(Stdio::from)
            .unwrap_or_else(Stdio::null);
        let stderr = log.ok().map(Stdio::from).unwrap_or_else(Stdio::null);

        let mut command = Command::new(&program);
        command
            .args(args)
            .current_dir(&repo_dir)
            .env("PATH", &path)
            .env("CHIEF_DEBUG_SESSION_FORCE", "1")
            .stdout(stdout)
            .stderr(stderr);

        #[cfg(unix)]
        command.process_group(0);

        match command.spawn() {
            Ok(child) => {
                eprintln!("[runtime] started agent runtime via {}", program.display());
                return Some(child);
            }
            Err(error) => {
                eprintln!("[runtime] failed to start {}: {error}", program.display());
            }
        }
    }

    None
}

#[cfg(not(debug_assertions))]
fn spawn_agent_runtime(app: &tauri::AppHandle) -> Option<Child> {
    use tauri::Manager;

    let executable_name = if cfg!(target_os = "windows") {
        "chief-agent-runtime.exe"
    } else {
        "chief-agent-runtime"
    };
    let sidecar = env::current_exe().ok()?.parent()?.join(executable_name);
    let runtime_root = installed_runtime_root(app)?;
    let writable_root = app.path().app_local_data_dir().ok()?;
    let runtime_bin = install_node_alias(&writable_root, &sidecar)?;
    let script = runtime_root.join("dist/server.mjs");
    if !sidecar.is_file() || !script.is_file() {
        eprintln!(
            "[runtime] bundled runtime is incomplete (sidecar: {}, script: {})",
            sidecar.display(),
            script.display()
        );
        return None;
    }

    let log_directory = app.path().app_log_dir().ok()?;
    let _ = std::fs::create_dir_all(&log_directory);
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_directory.join("agent-runtime.log"));
    let stdout = log
        .as_ref()
        .ok()
        .and_then(|file| file.try_clone().ok())
        .map(Stdio::from)
        .unwrap_or_else(Stdio::null);
    let stderr = log.ok().map(Stdio::from).unwrap_or_else(Stdio::null);

    let binary_suffix = if cfg!(target_os = "windows") {
        ".cmd"
    } else {
        ""
    };
    let mut command = Command::new(&sidecar);
    let mut path_entries = vec![runtime_bin];
    if let Some(current_path) = env::var_os("PATH") {
        path_entries.extend(env::split_paths(&current_path));
    }
    let path = env::join_paths(path_entries).ok()?;
    command
        .arg(&script)
        .current_dir(&runtime_root)
        .env("PATH", path)
        .env("CHIEF_RUNTIME_ROOT", &runtime_root)
        .env(
            "CHIEF_CODEX_BINARY",
            runtime_root.join(if cfg!(target_os = "windows") {
                "codex/bin/codex.exe"
            } else {
                "codex/bin/codex"
            }),
        )
        .env(
            "CHIEF_EXECUTOR_BINARY",
            runtime_root.join(format!("node_modules/.bin/executor{binary_suffix}")),
        )
        .stdout(stdout)
        .stderr(stderr);

    #[cfg(unix)]
    command.process_group(0);

    match command.spawn() {
        Ok(child) => {
            eprintln!("[runtime] started bundled agent runtime");
            Some(child)
        }
        Err(error) => {
            eprintln!("[runtime] failed to start bundled agent runtime: {error}");
            None
        }
    }
}

mod runtime_paths;

#[cfg(debug_assertions)]
use runtime_paths::find_node_binary;
#[cfg(not(debug_assertions))]
use runtime_paths::{install_node_alias, installed_runtime_root};

fn focus_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn activate_app_window(app: tauri::AppHandle) {
    focus_main_window(&app);
}

#[tauri::command]
fn show_native_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    _target: Option<serde_json::Value>,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|error| format!("native notification delivery failed: {error}"))?;
    // Do not enqueue a route here. Showing a notification is not clicking it;
    // enqueueing it makes the next focus event steal the user's location and
    // navigate into the source channel. Explicit click routing needs a native
    // notification action callback, not the delivery path.
    Ok(())
}

#[tauri::command]
fn take_pending_notification_activation(
    state: tauri::State<'_, PendingNotificationActivation>,
) -> Option<serde_json::Value> {
    state.take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::{Emitter, Manager, RunEvent};

    let app = tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(RuntimeProcess::start(handle.clone()));
            app.manage(PendingNotificationActivation::default());
            focus_main_window(&handle);
            Ok(())
        })
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // When a second instance is launched (e.g. via deep link),
            // focus the existing window and forward the URL.
            focus_main_window(app);
            // The deep link URL comes through as args — emit it so the
            // JS deep-link listener picks it up.
            if let Some(url) = args.into_iter().find(|a| a.starts_with("chief-desktop://")) {
                let _ = app.emit("deep-link://new-url", vec![url]);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            activate_app_window,
            show_native_notification,
            take_pending_notification_activation
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            app.state::<RuntimeProcess>().shutdown();
        }
    });
}
