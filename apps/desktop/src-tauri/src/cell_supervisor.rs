use std::{
    collections::{HashMap, HashSet},
    fs::OpenOptions,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::relay_identity::agent_private_key_hex;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCellConfiguration {
    agent_id: String,
    config: serde_json::Value,
}

#[derive(Default)]
pub struct CellSupervisor(Mutex<HashMap<String, Child>>);

impl CellSupervisor {
    pub fn stop_all(&self) {
        let Ok(mut children) = self.0.lock() else {
            return;
        };
        for child in children.values_mut() {
            terminate(child);
        }
        children.clear();
    }

    fn stop_removed(&self, scope: &str, active: &HashSet<String>) {
        let Ok(mut children) = self.0.lock() else {
            return;
        };
        children.retain(|key, child| {
            if !key.starts_with(scope) {
                return child.try_wait().ok().flatten().is_none();
            }
            if active.contains(key) && child.try_wait().ok().flatten().is_none() {
                return true;
            }
            terminate(child);
            false
        });
    }

    fn contains(&self, key: &str) -> bool {
        self.0.lock().ok().is_some_and(|mut children| {
            children
                .get_mut(key)
                .is_some_and(|child| child.try_wait().ok().flatten().is_none())
        })
    }

    fn insert(&self, key: String, child: Child) {
        if let Ok(mut children) = self.0.lock() {
            children.insert(key, child);
        }
    }
}

impl Drop for CellSupervisor {
    fn drop(&mut self) {
        self.stop_all();
    }
}

#[tauri::command]
pub fn start_workspace_cells(
    app: tauri::AppHandle,
    supervisor: tauri::State<'_, CellSupervisor>,
    relay_url: String,
    workspace_id: String,
    agents: Vec<AgentCellConfiguration>,
) -> Result<(), String> {
    crate::relay_identity::validate_relay_url(&relay_url)?;
    crate::relay_identity::validate_identifier(&workspace_id, "workspace")?;
    let active = agents
        .iter()
        .map(|agent| cell_key(&relay_url, &workspace_id, &agent.agent_id, &agent.config))
        .collect::<HashSet<_>>();
    supervisor.stop_removed(&cell_scope(&relay_url, &workspace_id), &active);

    for agent in agents {
        crate::relay_identity::validate_identifier(&agent.agent_id, "agent")?;
        let key = cell_key(&relay_url, &workspace_id, &agent.agent_id, &agent.config);
        if supervisor.contains(&key) {
            continue;
        }
        let child = spawn_cell(
            &app,
            &relay_url,
            &workspace_id,
            &agent.agent_id,
            &agent.config,
        )?;
        supervisor.insert(key, child);
    }
    Ok(())
}

fn cell_key(
    relay_url: &str,
    workspace_id: &str,
    agent_id: &str,
    config: &serde_json::Value,
) -> String {
    let config_key = hex::encode(Sha256::digest(config.to_string().as_bytes()));
    format!("{relay_url}\0{workspace_id}\0{agent_id}\0{config_key}")
}

fn cell_scope(relay_url: &str, workspace_id: &str) -> String {
    format!("{relay_url}\0{workspace_id}\0")
}

fn cell_directory(
    app: &tauri::AppHandle,
    relay_url: &str,
    workspace_id: &str,
    agent_id: &str,
) -> Result<PathBuf, String> {
    let relay_key = hex::encode(Sha256::digest(relay_url.as_bytes()));
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Chief could not resolve its local data directory.".to_string())?
        .join("cells")
        .join(&relay_key[..24])
        .join(workspace_id)
        .join(agent_id))
}

struct RuntimeRoot {
    path: PathBuf,
    packaged: bool,
}

fn runtime_root(app: &tauri::AppHandle) -> Result<RuntimeRoot, String> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|_| "Chief could not resolve its runtime resources.".to_string())?
        .join("agent-runtime");
    if packaged.join("dist/relay-cell-worker.mjs").is_file() {
        return Ok(RuntimeRoot {
            path: packaged,
            packaged: true,
        });
    }
    if !cfg!(debug_assertions) {
        return Err("Chief's built-in agent tools are unavailable. Reinstall Chief.".to_string());
    }
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/agent-runtime")
        .canonicalize()
        .map_err(|_| "Chief's development agent runtime is unavailable.".to_string())?;
    Ok(RuntimeRoot {
        path,
        packaged: false,
    })
}

fn spawn_cell(
    app: &tauri::AppHandle,
    relay_url: &str,
    workspace_id: &str,
    agent_id: &str,
    config: &serde_json::Value,
) -> Result<Child, String> {
    let runtime = runtime_root(app)?;
    let root = runtime.path;
    let cell_root = cell_directory(app, relay_url, workspace_id, agent_id)?;
    std::fs::create_dir_all(&cell_root)
        .map_err(|_| "Chief could not create the agent cell directory.".to_string())?;
    let log_directory = app
        .path()
        .app_log_dir()
        .map_err(|_| "Chief could not resolve its log directory.".to_string())?;
    std::fs::create_dir_all(&log_directory)
        .map_err(|_| "Chief could not create its log directory.".to_string())?;
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_directory.join(format!("cell-{agent_id}.log")))
        .map_err(|_| "Chief could not open the agent cell log.".to_string())?;
    let stdout = log
        .try_clone()
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null());
    let stderr = Stdio::from(log);

    let secret = agent_private_key_hex(relay_url, workspace_id, agent_id)?;
    let mut command = if runtime.packaged {
        let executable = std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(Path::to_path_buf))
            .map(|path| {
                path.join(if cfg!(target_os = "windows") {
                    "chief-agent-runtime.exe"
                } else {
                    "chief-agent-runtime"
                })
            })
            .filter(|path| path.is_file())
            .ok_or_else(|| "Chief's bundled Node runtime is unavailable.".to_string())?;
        let mut command = Command::new(executable);
        command.arg(root.join("dist/relay-cell-worker.mjs"));
        command
    } else {
        let mut command = Command::new("pnpm");
        command.args(["exec", "tsx", "src/relay-cell-worker.ts"]);
        command
    };

    let mut path_entries = vec![root.join("node_modules/.bin")];
    path_entries.extend(
        ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
            .into_iter()
            .map(PathBuf::from),
    );
    if let Some(current) = std::env::var_os("PATH") {
        path_entries.extend(std::env::split_paths(&current));
    }
    let path = std::env::join_paths(path_entries)
        .map_err(|_| "Chief could not prepare the agent process path.".to_string())?;
    let codex = root.join(if cfg!(target_os = "windows") {
        "codex/bin/codex.exe"
    } else {
        "codex/bin/codex"
    });
    command
        .current_dir(&root)
        .env("PATH", path)
        .env("CHIEF_RUNTIME_ROOT", &root)
        .env("CHIEF_CELL_ROOT", &cell_root)
        .env(
            "CHIEF_PLUGIN_ROOT",
            crate::plugin_host::plugin_directory(app)?,
        )
        .env("CHIEF_DATABASE_PATH", cell_root.join("cell.sqlite"))
        .env("CHIEF_RELAY_URL", relay_url)
        .env("CHIEF_WORKSPACE_ID", workspace_id)
        .env("CHIEF_AGENT_ID", agent_id)
        .env("CHIEF_AGENT_SECRET_KEY", secret)
        .env("CHIEF_AGENT_CONFIG", config.to_string())
        .env("CHIEF_CODEX_BINARY", codex)
        .stdout(stdout)
        .stderr(stderr);
    #[cfg(unix)]
    command.process_group(0);
    command
        .spawn()
        .map_err(|error| format!("Chief could not start the {agent_id} cell: {error}"))
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
