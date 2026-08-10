use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
};

fn parse_node_version(version: &str) -> Option<(u32, u32, u32)> {
    let mut parts = version
        .trim()
        .strip_prefix('v')
        .unwrap_or(version.trim())
        .split('.');
    let parsed = (
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    );
    parts.next().is_none().then_some(parsed)
}

#[cfg(debug_assertions)]
fn node_version(path: &Path) -> Option<(u32, u32, u32)> {
    let output = Command::new(path).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    parse_node_version(std::str::from_utf8(&output.stdout).ok()?)
}

#[cfg(debug_assertions)]
pub(crate) fn find_node_binary(repo_dir: &Path) -> Option<PathBuf> {
    let preferred = std::fs::read_to_string(repo_dir.join(".nvmrc"))
        .ok()
        .and_then(|version| parse_node_version(&version));
    let executable = if cfg!(windows) { "node.exe" } else { "node" };
    let mut candidates = Vec::new();

    if let Some(path) = env::var_os("CHIEF_NODE_BINARY").map(PathBuf::from) {
        candidates.push(path);
    }

    if let Some(path) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path).map(|directory| directory.join(executable)));
    }

    if !cfg!(windows) {
        candidates.extend(
            ["/opt/homebrew/bin/node", "/usr/local/bin/node"]
                .into_iter()
                .map(PathBuf::from),
        );
    }

    if let Some(home) = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
    {
        candidates.extend([
            home.join(".volta/bin").join(executable),
            home.join(".local/bin").join(executable),
        ]);

        // Finder-launched apps do not inherit shell initialization, so nvm's
        // active Node directory is absent from PATH.
        let versions = home.join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(versions) {
            candidates.extend(entries.filter_map(Result::ok).map(|entry| {
                if cfg!(windows) {
                    entry.path().join(executable)
                } else {
                    entry.path().join("bin").join(executable)
                }
            }));
        }
    }

    let mut fallback = None;
    for candidate in candidates {
        if !candidate.is_file() {
            continue;
        }
        let Some(version) = node_version(&candidate) else {
            eprintln!(
                "[runtime] rejected invalid Node candidate: {}",
                candidate.display()
            );
            continue;
        };
        if version.0 != 24 {
            eprintln!(
                "[runtime] rejected Node {}.{}.{} at {} (Node 24 required)",
                version.0,
                version.1,
                version.2,
                candidate.display()
            );
            continue;
        }
        if Some(version) == preferred {
            return Some(candidate);
        }
        fallback.get_or_insert(candidate);
    }
    fallback
}

#[cfg(not(debug_assertions))]
pub(crate) fn install_node_alias(writable_root: &Path, sidecar: &Path) -> Option<PathBuf> {
    let bin = writable_root.join(".chief-bin");
    std::fs::create_dir_all(&bin).ok()?;
    let alias = bin.join(if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    });
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
pub(crate) fn installed_runtime_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    use flate2::read::GzDecoder;
    use std::fs::{create_dir_all, read_dir, read_to_string, remove_dir_all, rename, File};
    use tauri::Manager;

    let version = app.package_info().version.to_string();
    let resource_directory = app.path().resource_dir().ok()?;
    let bundled = resource_directory.join("agent-runtime");
    if bundled.join("dist/server.mjs").is_file() {
        return Some(bundled);
    }
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
