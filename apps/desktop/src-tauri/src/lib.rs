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
    let _ = child.kill();
    let _ = child.wait();
}

impl RuntimeProcess {
    fn start(app: tauri::AppHandle) -> Self {
        #[cfg(not(debug_assertions))]
        terminate_recorded_runtime(&app);

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
                } else if now >= next_spawn_at {
                    child = spawn_agent_runtime(&app);
                    if child.is_some() {
                        #[cfg(not(debug_assertions))]
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

#[cfg(not(debug_assertions))]
fn runtime_process_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;

    Some(
        app.path()
            .app_local_data_dir()
            .ok()?
            .join("agent-runtime.pid"),
    )
}

#[cfg(not(debug_assertions))]
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

#[cfg(not(debug_assertions))]
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
        .and_then(process_command)
        .is_some()
    {
        return;
    }

    let is_chief_runtime = process_command(runtime_pid)
        .map(|command| command.contains("chief-agent-runtime"))
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

#[cfg(not(debug_assertions))]
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

impl Drop for RuntimeProcess {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn runtime_is_running() -> bool {
    let addr: SocketAddr = "127.0.0.1:4318"
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
    let chief_header = lines.any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.eq_ignore_ascii_case("x-chief-runtime") && value.trim() == "ready"
        })
    });
    ready_status && chief_header
}

#[cfg(test)]
mod runtime_health_tests {
    use super::is_runtime_health_response;

    #[test]
    fn accepts_only_the_ready_chief_runtime() {
        assert!(is_runtime_health_response(
            b"HTTP/1.1 200 OK\r\nx-chief-runtime: ready\r\n\r\nchief-runtime-ready"
        ));
        assert!(!is_runtime_health_response(b"HTTP/1.1 200 OK\r\n\r\n"));
        assert!(!is_runtime_health_response(
            b"HTTP/1.1 503 Service Unavailable\r\nx-chief-runtime: ready\r\n\r\n"
        ));
        assert!(!is_runtime_health_response(
            b"HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\n\r\nx-chief-runtime: ready"
        ));
    }
}

#[cfg(debug_assertions)]
fn node_version(path: &Path) -> Option<(u32, u32, u32)> {
    let version = path.parent()?.parent()?.file_name()?.to_str()?;
    let mut parts = version.strip_prefix('v')?.split('.');
    Some((
        parts.next()?.parse().ok()?,
        parts.next().unwrap_or("0").parse().ok()?,
        parts.next().unwrap_or("0").parse().ok()?,
    ))
}

#[cfg(debug_assertions)]
fn find_node_binary() -> Option<PathBuf> {
    if let Some(path) = env::var_os("CHIEF_NODE_BINARY").map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }

    if let Some(path) = env::var_os("PATH") {
        if let Some(node) = env::split_paths(&path)
            .map(|directory| directory.join("node"))
            .find(|candidate| candidate.is_file())
        {
            return Some(node);
        }
    }

    for path in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let home = env::var_os("HOME").map(PathBuf::from)?;
    for path in [home.join(".volta/bin/node"), home.join(".local/bin/node")] {
        if path.is_file() {
            return Some(path);
        }
    }

    // Finder-launched apps do not inherit shell initialization, so nvm's
    // active Node directory is absent from PATH. Prefer the newest installed
    // Node that satisfies the workspace's Node 24+ requirement.
    let versions = home.join(".nvm/versions/node");
    std::fs::read_dir(versions)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("bin/node"))
        .filter(|candidate| candidate.is_file())
        .filter_map(|candidate| {
            let version = node_version(&candidate)?;
            (version.0 >= 24).then_some((version, candidate))
        })
        .max_by_key(|(version, _)| *version)
        .map(|(_, candidate)| candidate)
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

    let node_binary = find_node_binary();
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
            vec!["pnpm", "--filter", "@chief/agent-runtime", "start"],
        ),
        (
            PathBuf::from("corepack"),
            vec!["pnpm", "--filter", "@chief/agent-runtime", "start"],
        ),
        (
            PathBuf::from("/opt/homebrew/bin/pnpm"),
            vec!["--filter", "@chief/agent-runtime", "start"],
        ),
    ];
    if let Some(home) = env::var_os("HOME") {
        candidates.push((
            PathBuf::from(home).join("Library/pnpm/pnpm"),
            vec!["--filter", "@chief/agent-runtime", "start"],
        ));
    }

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
    let runtime_bin = install_node_alias(&runtime_root, &sidecar)?;
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
            runtime_root.join(format!("node_modules/.bin/codex{binary_suffix}")),
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

#[cfg(not(debug_assertions))]
fn install_node_alias(runtime_root: &Path, sidecar: &Path) -> Option<PathBuf> {
    let bin = runtime_root.join(".chief-bin");
    std::fs::create_dir_all(&bin).ok()?;
    let alias = bin.join(if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    });
    if alias.is_file() {
        return Some(bin);
    }
    let _ = std::fs::remove_file(&alias);

    #[cfg(unix)]
    std::os::unix::fs::symlink(sidecar, &alias).ok()?;

    #[cfg(windows)]
    if std::fs::hard_link(sidecar, &alias).is_err() {
        std::fs::copy(sidecar, &alias).ok()?;
    }

    Some(bin)
}

#[cfg(not(debug_assertions))]
fn installed_runtime_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    use flate2::read::GzDecoder;
    use std::fs::{create_dir_all, read_dir, read_to_string, remove_dir_all, rename, File};
    use tauri::Manager;

    let version = app.package_info().version.to_string();
    let resource_directory = app.path().resource_dir().ok()?;
    let runtime_version = read_to_string(resource_directory.join("agent-runtime.version"))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| {
            !value.is_empty() && value.chars().all(|character| character.is_ascii_hexdigit())
        })
        .unwrap_or_else(|| version.clone());
    let install_id = format!("{version}-{runtime_version}");
    let parent = app.path().app_local_data_dir().ok()?.join("agent-runtime");
    let destination = parent.join(&install_id);
    let marker = destination.join(".ready");
    let script = destination.join("dist/server.mjs");
    if marker.is_file() && script.is_file() {
        return Some(destination);
    }

    let archive_path = resource_directory.join("agent-runtime.tar.gz");
    if !archive_path.is_file() {
        eprintln!(
            "[runtime] bundled runtime archive is missing: {}",
            archive_path.display()
        );
        return None;
    }

    let staging = parent.join(format!(".{install_id}-{}", std::process::id()));
    let _ = remove_dir_all(&staging);
    create_dir_all(&staging).ok()?;
    let archive_file = File::open(&archive_path).ok()?;
    let mut archive = tar::Archive::new(GzDecoder::new(archive_file));
    if let Err(error) = archive.unpack(&staging) {
        eprintln!("[runtime] could not install bundled runtime: {error}");
        let _ = remove_dir_all(&staging);
        return None;
    }
    if !staging.join("dist/server.mjs").is_file() {
        eprintln!("[runtime] installed runtime is missing its server entrypoint");
        let _ = remove_dir_all(&staging);
        return None;
    }

    std::fs::write(staging.join(".ready"), format!("{install_id}\n")).ok()?;
    let _ = remove_dir_all(&destination);
    if let Err(error) = rename(&staging, &destination) {
        eprintln!("[runtime] could not activate bundled runtime: {error}");
        let _ = remove_dir_all(&staging);
        return None;
    }
    if let Ok(entries) = read_dir(&parent) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path != destination && path.is_dir() {
                let _ = remove_dir_all(path);
            }
        }
    }
    Some(destination)
}

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::{Emitter, Manager, RunEvent};

    let app = tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(RuntimeProcess::start(handle.clone()));
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
        .invoke_handler(tauri::generate_handler![greet, activate_app_window])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            app.state::<RuntimeProcess>().shutdown();
        }
    });
}
