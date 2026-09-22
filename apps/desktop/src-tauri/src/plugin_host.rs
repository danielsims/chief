use std::{
    fs::OpenOptions,
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

use k256::elliptic_curve::rand_core::{OsRng, RngCore};
use tauri::Manager;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

struct PluginHostProcess {
    child: Child,
    connection: PluginHostConnection,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginHostConnection {
    token: String,
    port: u16,
}

#[derive(Default)]
pub struct PluginHostSupervisor {
    process: Mutex<Option<PluginHostProcess>>,
    startup: Mutex<()>,
    stopping: AtomicBool,
}

impl PluginHostSupervisor {
    pub fn stop(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        let Ok(mut process) = self.process.lock() else {
            return;
        };
        if let Some(mut process) = process.take() {
            terminate(&mut process.child);
        }
    }
}

impl Drop for PluginHostSupervisor {
    fn drop(&mut self) {
        self.stop();
    }
}

pub(crate) fn plugin_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Chief could not resolve its local data directory.".to_string())?
        .join("plugins"))
}

struct RuntimeRoot {
    path: PathBuf,
    packaged: bool,
    executable: Option<PathBuf>,
}

fn runtime_root(app: &tauri::AppHandle) -> Result<RuntimeRoot, String> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|_| "Chief could not resolve its runtime resources.".to_string())?
        .join("agent-runtime");
    if packaged.join("dist/plugin-host-worker.mjs").is_file() {
        return Ok(RuntimeRoot {
            path: packaged,
            packaged: true,
            executable: None,
        });
    }
    if !cfg!(debug_assertions) {
        let installed = crate::plugin_runtime::ensure(app)?;
        return Ok(RuntimeRoot {
            path: installed.join("agent-runtime"),
            packaged: true,
            executable: Some(installed.join(crate::plugin_runtime::node_name())),
        });
    }
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/agent-runtime")
        .canonicalize()
        .map_err(|_| "Chief's development agent runtime is unavailable.".to_string())?;
    Ok(RuntimeRoot {
        path,
        packaged: false,
        executable: None,
    })
}

#[tauri::command]
pub async fn start_plugin_host(app: tauri::AppHandle) -> Result<PluginHostConnection, String> {
    tauri::async_runtime::spawn_blocking(move || start(&app))
        .await
        .map_err(|_| "Chief's runtime setup stopped unexpectedly.".to_string())?
}

fn start(app: &tauri::AppHandle) -> Result<PluginHostConnection, String> {
    let supervisor = app.state::<PluginHostSupervisor>();
    let _startup = supervisor
        .startup
        .lock()
        .map_err(|_| "Chief could not prepare its plugin host.".to_string())?;
    if supervisor.stopping.load(Ordering::SeqCst) {
        return Err("Chief is shutting down.".into());
    }
    let mut process = supervisor
        .process
        .lock()
        .map_err(|_| "Chief could not access its plugin host.".to_string())?;
    if let Some(current) = process.as_mut() {
        if current.child.try_wait().ok().flatten().is_none() {
            return Ok(current.connection.clone());
        }
    }

    drop(process);
    let runtime = runtime_root(app)?;
    let mut process = supervisor
        .process
        .lock()
        .map_err(|_| "Chief could not access its plugin host.".to_string())?;
    if supervisor.stopping.load(Ordering::SeqCst) {
        return Err("Chief is shutting down.".into());
    }
    crate::plugin_runtime::progress(app, "starting");
    let root = runtime.path;
    let plugin_root = plugin_directory(app)?;
    std::fs::create_dir_all(&plugin_root)
        .map_err(|_| "Chief could not create its plugin directory.".to_string())?;
    let log_directory = app
        .path()
        .app_log_dir()
        .map_err(|_| "Chief could not resolve its log directory.".to_string())?;
    std::fs::create_dir_all(&log_directory)
        .map_err(|_| "Chief could not create its log directory.".to_string())?;
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_directory.join("plugin-host.log"))
        .map_err(|_| "Chief could not open its plugin log.".to_string())?;
    let stdout = log
        .try_clone()
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null());

    let mut command = if runtime.packaged {
        let executable = runtime
            .executable
            .or_else(|| {
                std::env::current_exe()
                    .ok()
                    .and_then(|path| path.parent().map(Path::to_path_buf))
                    .map(|path| {
                        path.join(if cfg!(target_os = "windows") {
                            "chief-agent-runtime.exe"
                        } else {
                            "chief-agent-runtime"
                        })
                    })
            })
            .filter(|path| path.is_file())
            .ok_or_else(|| "Chief's bundled Node runtime is unavailable.".to_string())?;
        let mut command = Command::new(executable);
        command.arg(root.join("dist/plugin-host-worker.mjs"));
        command
    } else {
        let mut command = Command::new("pnpm");
        command.args(["exec", "tsx", "src/plugin-host-worker.ts"]);
        command
    };

    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let token = hex::encode(bytes);
    let port = available_loopback_port()?;
    let mut paths = vec![
        std::path::PathBuf::from("/opt/homebrew/bin"),
        std::path::PathBuf::from("/usr/local/bin"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        paths.push(std::path::PathBuf::from(home).join(".local/bin"));
    }
    if let Some(current) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&current));
    }
    let path = std::env::join_paths(paths)
        .map_err(|_| "Chief could not resolve its Git credential helper path.".to_string())?;
    command
        .env("PATH", path)
        .current_dir(&root)
        .env("CHIEF_PLUGIN_HOST_TOKEN", &token)
        .env("CHIEF_PLUGIN_HOST_PORT", port.to_string())
        .env("CHIEF_PLUGIN_ROOT", &plugin_root)
        .stdout(stdout)
        .stderr(Stdio::from(log));
    #[cfg(unix)]
    command.process_group(0);
    let child = command
        .spawn()
        .map_err(|error| format!("Chief could not start its plugin host: {error}"))?;
    let connection = PluginHostConnection { token, port };
    *process = Some(PluginHostProcess {
        child,
        connection: connection.clone(),
    });
    Ok(connection)
}

fn available_loopback_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("Chief could not reserve a plugin host port: {error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("Chief could not resolve its plugin host port: {error}"))
}

fn terminate(child: &mut Child) {
    #[cfg(unix)]
    {
        let _ = Command::new("/bin/kill")
            .args(["-TERM", &format!("-{}", child.id())])
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
