use std::{
    fs::OpenOptions,
    net::{SocketAddr, TcpStream},
    path::Path,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

struct RuntimeProcess(Mutex<Option<Child>>);

impl Drop for RuntimeProcess {
    fn drop(&mut self) {
        if let Ok(mut child) = self.0.lock() {
            if let Some(child) = child.as_mut() {
                let _ = child.kill();
            }
        }
    }
}

fn runtime_is_running() -> bool {
    let addr: SocketAddr = "127.0.0.1:4318"
        .parse()
        .expect("valid local runtime socket address");
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

fn start_agent_runtime() -> Option<Child> {
    if runtime_is_running() {
        return None;
    }

    let repo_dir = std::env::var("MARKETER_REPO_DIR")
        .unwrap_or_else(|_| "/Users/danielsims/Documents/Development/marketer".to_string());
    if !Path::new(&repo_dir).exists() {
        eprintln!("[runtime] repo directory not found: {repo_dir}");
        return None;
    }

    let path = [
        "/Users/danielsims/.nvm/versions/node/v22.21.0/bin",
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ]
    .join(":");

    let candidates: [(&str, &[&str]); 4] = [
        (
            "/Users/danielsims/.nvm/versions/node/v22.21.0/bin/corepack",
            &["pnpm", "--filter", "@marketer/agent-runtime", "start"],
        ),
        (
            "/opt/homebrew/bin/corepack",
            &["pnpm", "--filter", "@marketer/agent-runtime", "start"],
        ),
        (
            "corepack",
            &["pnpm", "--filter", "@marketer/agent-runtime", "start"],
        ),
        (
            "/opt/homebrew/bin/pnpm",
            &["--filter", "@marketer/agent-runtime", "start"],
        ),
    ];

    for (program, args) in candidates {
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open("/tmp/marketer-agent-runtime.log");
        let stdout = log
            .as_ref()
            .ok()
            .and_then(|file| file.try_clone().ok())
            .map(Stdio::from)
            .unwrap_or_else(Stdio::null);
        let stderr = log.ok().map(Stdio::from).unwrap_or_else(Stdio::null);

        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(&repo_dir)
            .env("PATH", &path)
            .stdout(stdout)
            .stderr(stderr);

        match command.spawn() {
            Ok(child) => {
                eprintln!("[runtime] started agent runtime via {program}");
                return Some(child);
            }
            Err(error) => {
                eprintln!("[runtime] failed to start {program}: {error}");
            }
        }
    }

    None
}

#[cfg(target_os = "macos")]
fn activate_app() {
    let _ = Command::new("osascript")
        .args([
            "-e",
            "tell application id \"com.danielsims.marketer\" to activate",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

#[cfg(not(target_os = "macos"))]
fn activate_app() {}

fn focus_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }

    activate_app();
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
    use tauri::{Emitter, Manager};

    tauri::Builder::default()
        .setup(|app| {
            app.manage(RuntimeProcess(Mutex::new(start_agent_runtime())));
            let handle = app.handle().clone();
            focus_main_window(&handle);
            Ok(())
        })
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // When a second instance is launched (e.g. via deep link),
            // focus the existing window and forward the URL.
            focus_main_window(app);
            // The deep link URL comes through as args — emit it so the
            // JS deep-link listener picks it up.
            if let Some(url) = args
                .into_iter()
                .find(|a| a.starts_with("marketer-desktop://"))
            {
                let _ = app.emit("deep-link://new-url", vec![url]);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![greet, activate_app_window])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
