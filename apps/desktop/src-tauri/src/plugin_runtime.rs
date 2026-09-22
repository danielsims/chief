use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::Duration,
};
use tauri::{Emitter, Manager};

const MAX_DOWNLOAD: u64 = 256 * 1024 * 1024;
const MAX_UNPACKED: u64 = 1024 * 1024 * 1024;

#[derive(serde::Deserialize)]
struct Release {
    url: String,
    sha256: String,
}

pub(crate) fn progress(app: &tauri::AppHandle, stage: &str) {
    let _ = app.emit("chief://plugin-runtime-progress", stage);
}

pub(crate) fn ensure(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let releases: std::collections::HashMap<String, Release> =
        serde_json::from_str(include_str!("../plugin-runtime-release.json"))
            .map_err(|_| "Chief's runtime release information is invalid.".to_string())?;
    let release = releases
        .get(env!("CHIEF_BUILD_TARGET"))
        .ok_or("The plugin runtime is not available for this platform yet.")?;
    validate_release(release)?;
    let parent = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Chief could not locate its runtime directory.")?
        .join("plugin-runtimes");
    install(&parent, release, |stage| progress(app, stage))
}

fn validate_release(release: &Release) -> Result<(), String> {
    let url = url::Url::parse(&release.url).map_err(|_| "Invalid runtime download URL.")?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url
            .path()
            .starts_with("/danielsims/chief/releases/download/")
        || !url.username().is_empty()
        || url.password().is_some()
        || release.sha256.len() != 64
        || !release.sha256.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Invalid runtime release information.".into());
    }
    Ok(())
}

fn complete(root: &Path, digest: &str) -> bool {
    fs::read_to_string(root.join(".verified")).ok().as_deref() == Some(digest)
        && root.join(node_name()).is_file()
        && root
            .join("agent-runtime/dist/plugin-host-worker.mjs")
            .is_file()
}

pub(crate) fn node_name() -> &'static str {
    if cfg!(windows) {
        "chief-agent-runtime.exe"
    } else {
        "chief-agent-runtime"
    }
}

fn download(url: &str, archive: &Path) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|_| {
            "Could not download Chief's plugin runtime. Check your connection and try again."
                .to_string()
        })?;
    let mut output = fs::File::create(archive).map_err(|e| e.to_string())?;
    let mut input = response.take(MAX_DOWNLOAD + 1);
    let mut hash = Sha256::new();
    let mut size = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = input
            .read(&mut buffer)
            .map_err(|_| "Runtime download was interrupted. Try again.".to_string())?;
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > MAX_DOWNLOAD {
            return Err("Runtime download exceeds the size limit.".into());
        }
        hash.update(&buffer[..count]);
        output
            .write_all(&buffer[..count])
            .map_err(|e| e.to_string())?;
    }
    drop(output);
    Ok(hex::encode(hash.finalize()))
}

fn install(parent: &Path, release: &Release, report: impl Fn(&str)) -> Result<PathBuf, String> {
    install_with(parent, release, report, |archive| {
        download(&release.url, archive)
    })
}

fn install_with(
    parent: &Path,
    release: &Release,
    report: impl Fn(&str),
    download: impl FnOnce(&Path) -> Result<String, String>,
) -> Result<PathBuf, String> {
    let destination = parent.join(&release.sha256);
    if complete(&destination, &release.sha256) {
        return Ok(destination);
    }
    fs::create_dir_all(parent).map_err(|e| format!("Could not create runtime directory: {e}"))?;
    // A unique staging directory keeps interrupted downloads out of the usable cache.
    use k256::elliptic_curve::rand_core::{OsRng, RngCore};
    let mut random = [0u8; 16];
    OsRng.fill_bytes(&mut random);
    let staging = parent.join(format!(".install-{}", hex::encode(random)));
    fs::create_dir(&staging).map_err(|e| format!("Could not prepare runtime installation: {e}"))?;
    let result = (|| {
        report("downloading");
        let archive = staging.join("runtime.tar.gz");
        let digest = download(&archive)?;
        report("verifying");
        verify_digest(&digest, &release.sha256)?;
        report("installing");
        let extracted = staging.join("payload");
        fs::create_dir(&extracted).map_err(|e| e.to_string())?;
        unpack(&archive, &extracted)?;
        if !extracted.join(node_name()).is_file()
            || !extracted
                .join("agent-runtime/dist/plugin-host-worker.mjs")
                .is_file()
        {
            return Err("The runtime package is incomplete.".into());
        }
        fs::write(extracted.join(".verified"), &release.sha256).map_err(|e| e.to_string())?;
        // Only a fully verified package is made visible to the launcher.
        if destination.exists() {
            fs::remove_dir_all(&destination).map_err(|e| e.to_string())?;
        }
        fs::rename(&extracted, &destination)
            .map_err(|e| format!("Could not finish runtime installation: {e}"))?;
        Ok(destination)
    })();
    let _ = fs::remove_dir_all(&staging);
    result
}

fn verify_digest(actual: &str, expected: &str) -> Result<(), String> {
    if actual != expected {
        return Err("Runtime verification failed. Nothing was installed. Try again.".into());
    }
    Ok(())
}

fn unpack(archive: &Path, destination: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(file));
    let mut total = 0u64;
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        let kind = entry.header().entry_type();
        if path
            .components()
            .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
            || !(kind.is_file() || kind.is_dir())
        {
            return Err("Runtime archive contains an unsafe entry.".into());
        }
        total = total
            .checked_add(entry.size())
            .ok_or("Runtime archive is too large.")?;
        if total > MAX_UNPACKED {
            return Err("Runtime archive is too large.".into());
        }
        if !entry.unpack_in(destination).map_err(|e| e.to_string())? {
            return Err("Runtime archive entry escaped its destination.".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp_root() -> PathBuf {
        use k256::elliptic_curve::rand_core::{OsRng, RngCore};
        let mut bytes = [0u8; 16];
        OsRng.fill_bytes(&mut bytes);
        let path = std::env::temp_dir().join(format!("chief-runtime-test-{}", hex::encode(bytes)));
        fs::create_dir(&path).unwrap();
        path
    }

    fn fixture(path: &Path, symlink: bool) {
        let gz = flate2::write::GzEncoder::new(
            fs::File::create(path).unwrap(),
            flate2::Compression::default(),
        );
        let mut tar = tar::Builder::new(gz);
        for name in [node_name(), "agent-runtime/dist/plugin-host-worker.mjs"] {
            let mut header = tar::Header::new_gnu();
            header.set_size(4);
            header.set_mode(0o755);
            header.set_cksum();
            tar.append_data(&mut header, name, &b"test"[..]).unwrap();
        }
        if symlink {
            let mut header = tar::Header::new_gnu();
            header.set_entry_type(tar::EntryType::Symlink);
            header.set_size(0);
            header.set_mode(0o777);
            header.set_cksum();
            tar.append_link(&mut header, "escape", "../outside")
                .unwrap();
        }
        tar.into_inner().unwrap().finish().unwrap();
    }

    #[test]
    fn installs_once_and_reuses_verified_cache() {
        let root = temp_root();
        let source = root.join("fixture.gz");
        fixture(&source, false);
        let digest = hex::encode(Sha256::digest(fs::read(&source).unwrap()));
        let release = Release {
            url: String::new(),
            sha256: digest.clone(),
        };
        let cache = root.join("cache");
        let result = install_with(
            &cache,
            &release,
            |_| {},
            |target| {
                fs::copy(&source, target).unwrap();
                Ok(digest.clone())
            },
        )
        .unwrap();
        assert!(complete(&result, &digest));
        assert_eq!(
            install_with(
                &cache,
                &release,
                |_| {},
                |_| panic!("cache must not download again")
            )
            .unwrap(),
            result
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_verification_and_unsafe_archives_leave_no_install() {
        let root = temp_root();
        let source = root.join("fixture.gz");
        fixture(&source, true);
        let release = Release {
            url: String::new(),
            sha256: "a".repeat(64),
        };
        let cache = root.join("cache");
        for digest in ["wrong".to_string(), release.sha256.clone()] {
            assert!(install_with(
                &cache,
                &release,
                |_| {},
                |target| {
                    fs::copy(&source, target).unwrap();
                    Ok(digest)
                }
            )
            .is_err());
            assert_eq!(fs::read_dir(&cache).unwrap().count(), 0);
        }
        // A network failure is also cleaned up, allowing the next attempt to retry.
        assert!(install_with(&cache, &release, |_| {}, |_| Err("offline".into())).is_err());
        assert_eq!(fs::read_dir(&cache).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "Requires a locally built release archive"]
    fn verifies_and_installs_release_artifact() {
        let archive = PathBuf::from(std::env::var("CHIEF_TEST_RUNTIME_ARCHIVE").unwrap());
        let releases: std::collections::HashMap<String, Release> =
            serde_json::from_str(include_str!("../plugin-runtime-release.json")).unwrap();
        let release = releases.get(env!("CHIEF_BUILD_TARGET")).unwrap();
        let root = temp_root();
        let installed = install_with(
            &root,
            release,
            |_| {},
            |target| {
                fs::copy(&archive, target).unwrap();
                Ok(hex::encode(Sha256::digest(fs::read(target).unwrap())))
            },
        )
        .unwrap();
        let status = std::process::Command::new(installed.join(node_name()))
            .arg(installed.join("agent-runtime/dist/plugin-host-worker.mjs"))
            .env("CHIEF_PLUGIN_HOST_SMOKE", "1")
            .status()
            .unwrap();
        assert!(status.success());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_changed_downloads() {
        assert!(verify_digest("changed", "expected").is_err());
        assert!(verify_digest("expected", "expected").is_ok());
    }
    #[test]
    fn restricts_release_origin() {
        for url in [
            "http://github.com/danielsims/chief/releases/download/v1/runtime.tar.gz",
            "https://evil.example/runtime.tar.gz",
            "https://github.com/other/repo/releases/download/v1/runtime.tar.gz",
        ] {
            assert!(validate_release(&Release {
                url: url.into(),
                sha256: "a".repeat(64)
            })
            .is_err());
        }
    }
    #[test]
    fn incomplete_cache_is_not_used() {
        assert!(!complete(
            Path::new("/nonexistent-chief-runtime-test"),
            "abc"
        ));
    }
}
