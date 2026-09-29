use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::Manager;

const MAX_DOWNLOAD: u64 = 256 * 1024 * 1024;
const MAX_UNPACKED: u64 = 1024 * 1024 * 1024;
/// Waits between download attempts for failures that may clear up.
const RETRY_DELAYS: [Duration; 3] = [
    Duration::from_secs(2),
    Duration::from_secs(8),
    Duration::from_secs(20),
];

/// Serialises installs so the launch prefetch and the plugin host share one download.
static INSTALL: Mutex<()> = Mutex::new(());

#[derive(serde::Deserialize)]
struct Release {
    url: String,
    sha256: String,
}

/// Installation failures that another attempt might fix.
#[derive(Debug)]
enum Failure {
    Transient(String),
    Fatal(String),
    Unsupported(String),
}

impl Failure {
    fn message(self) -> String {
        match self {
            Failure::Transient(message)
            | Failure::Fatal(message)
            | Failure::Unsupported(message) => message,
        }
    }
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Failure::Fatal(message)
    }
}

impl From<&str> for Failure {
    fn from(message: &str) -> Self {
        Failure::Fatal(message.into())
    }
}

/// Whether this build fetches its runtime instead of shipping it.
pub(crate) fn downloads_runtime(app: &tauri::AppHandle) -> bool {
    !cfg!(debug_assertions)
        && !app
            .path()
            .resource_dir()
            .map(|dir| {
                dir.join("agent-runtime/dist/plugin-host-worker.mjs")
                    .is_file()
            })
            .unwrap_or(false)
}

/// Installs the runtime in the background at launch so no screen ever waits on it.
pub(crate) fn prefetch(app: &tauri::AppHandle) {
    if !downloads_runtime(app) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        // Failures are logged; the plugin host retries on first use.
        let _ = ensure(&app);
    });
}

pub(crate) fn ensure(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let _guard = INSTALL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    ensure_locked(app).map_err(|failure| match failure {
        Failure::Unsupported(message) => message,
        other => {
            // The detail is for the log; people only need to know it will recover.
            log(app, &other.message());
            "Chief couldn't finish setting up local plugins. It will try again shortly.".into()
        }
    })
}

fn ensure_locked(app: &tauri::AppHandle) -> Result<PathBuf, Failure> {
    let releases: std::collections::HashMap<String, Release> = serde_json::from_str(include_str!(
        concat!(env!("OUT_DIR"), "/plugin-runtime-release.json")
    ))
    .map_err(|_| "Chief's runtime release information is invalid.")?;
    let release = releases.get(env!("CHIEF_BUILD_TARGET")).ok_or_else(|| {
        Failure::Unsupported("Local plugins are not available on this platform yet.".into())
    })?;
    validate_release(release)?;
    let parent = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Chief could not locate its runtime directory.")?
        .join("plugin-runtimes");
    let installed = with_retries(&RETRY_DELAYS, std::thread::sleep, || {
        install(&parent, release)
    })?;
    remove_stale(&parent, &installed);
    Ok(installed)
}

fn log(app: &tauri::AppHandle, error: &str) {
    eprintln!("[plugin-runtime] {error}");
    let Ok(directory) = app.path().app_log_dir() else {
        return;
    };
    let _ = fs::create_dir_all(&directory);
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(directory.join("plugin-runtime.log"))
    {
        let _ = writeln!(file, "{error}");
    }
}

fn with_retries<T>(
    delays: &[Duration],
    sleep: impl Fn(Duration),
    mut attempt: impl FnMut() -> Result<T, Failure>,
) -> Result<T, Failure> {
    let mut delays = delays.iter();
    loop {
        match attempt() {
            Ok(value) => return Ok(value),
            Err(Failure::Transient(message)) => match delays.next() {
                Some(delay) => {
                    eprintln!("[plugin-runtime] {message} Retrying.");
                    sleep(*delay);
                }
                None => return Err(Failure::Transient(message)),
            },
            Err(failure) => return Err(failure),
        }
    }
}

/// Drops runtimes from earlier builds and abandoned staging directories.
fn remove_stale(parent: &Path, current: &Path) {
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path != current && path.is_dir() {
            let _ = fs::remove_dir_all(path);
        }
    }
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

fn download(url: &str, archive: &Path) -> Result<String, Failure> {
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(url).send().map_err(|error| {
        Failure::Transient(format!(
            "Could not reach the plugin runtime download: {error}."
        ))
    })?;
    let status = response.status();
    if !status.is_success() {
        let message = format!("The plugin runtime download returned HTTP {status}.");
        // Server errors and rate limits clear up; a missing asset will not.
        return Err(if status.is_server_error() || status.as_u16() == 429 {
            Failure::Transient(message)
        } else {
            Failure::Fatal(message)
        });
    }
    let mut output = fs::File::create(archive).map_err(|e| e.to_string())?;
    let mut input = response.take(MAX_DOWNLOAD + 1);
    let mut hash = Sha256::new();
    let mut size = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = input
            .read(&mut buffer)
            .map_err(|_| Failure::Transient("Runtime download was interrupted.".into()))?;
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

fn install(parent: &Path, release: &Release) -> Result<PathBuf, Failure> {
    install_with(parent, release, |archive| download(&release.url, archive))
}

fn install_with(
    parent: &Path,
    release: &Release,
    download: impl FnOnce(&Path) -> Result<String, Failure>,
) -> Result<PathBuf, Failure> {
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
        let archive = staging.join("runtime.tar.gz");
        let digest = download(&archive)?;
        verify_digest(&digest, &release.sha256)?;
        let extracted = staging.join("payload");
        fs::create_dir(&extracted).map_err(|e| e.to_string())?;
        unpack(&archive, &extracted)?;
        if !extracted.join(node_name()).is_file()
            || !extracted
                .join("agent-runtime/dist/plugin-host-worker.mjs")
                .is_file()
        {
            return Err(Failure::Fatal("The runtime package is incomplete.".into()));
        }
        fs::write(extracted.join(".verified"), &release.sha256).map_err(|e| e.to_string())?;
        // Only a fully verified package is made visible to the launcher.
        if destination.exists() {
            fs::remove_dir_all(&destination).map_err(|e| e.to_string())?;
        }
        fs::rename(&extracted, &destination)
            .map_err(|e| format!("Could not finish runtime installation: {e}"))?;
        Ok::<_, Failure>(destination)
    })();
    let _ = fs::remove_dir_all(&staging);
    result
}

fn verify_digest(actual: &str, expected: &str) -> Result<(), Failure> {
    if actual != expected {
        // Usually a truncated or corrupted transfer, so another download is worth trying.
        return Err(Failure::Transient(
            "Runtime verification failed. Nothing was installed.".into(),
        ));
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
        let result = install_with(&cache, &release, |target| {
            fs::copy(&source, target).unwrap();
            Ok(digest.clone())
        })
        .unwrap();
        assert!(complete(&result, &digest));
        assert_eq!(
            install_with(&cache, &release, |_| panic!(
                "cache must not download again"
            ))
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
            assert!(install_with(&cache, &release, |target| {
                fs::copy(&source, target).unwrap();
                Ok(digest)
            })
            .is_err());
            assert_eq!(fs::read_dir(&cache).unwrap().count(), 0);
        }
        // A network failure is also cleaned up, allowing the next attempt to retry.
        assert!(install_with(&cache, &release, |_| {
            Err(Failure::Transient("offline".into()))
        })
        .is_err());
        assert_eq!(fs::read_dir(&cache).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "Requires a locally built release archive"]
    fn verifies_and_installs_release_artifact() {
        let archive = PathBuf::from(std::env::var("CHIEF_TEST_RUNTIME_ARCHIVE").unwrap());
        let releases: std::collections::HashMap<String, Release> = serde_json::from_str(
            include_str!(concat!(env!("OUT_DIR"), "/plugin-runtime-release.json")),
        )
        .unwrap();
        let release = releases.get(env!("CHIEF_BUILD_TARGET")).unwrap();
        let root = temp_root();
        let installed = install_with(&root, release, |target| {
            fs::copy(&archive, target).unwrap();
            Ok(hex::encode(Sha256::digest(fs::read(target).unwrap())))
        })
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
    fn retries_only_transient_failures() {
        let attempts = std::cell::Cell::new(0);
        let result = with_retries(
            &RETRY_DELAYS,
            |_| {},
            || {
                attempts.set(attempts.get() + 1);
                if attempts.get() < 3 {
                    Err(Failure::Transient("offline".into()))
                } else {
                    Ok(())
                }
            },
        );
        assert!(result.is_ok());
        assert_eq!(attempts.get(), 3);

        attempts.set(0);
        let result: Result<(), _> = with_retries(
            &RETRY_DELAYS,
            |_| {},
            || {
                attempts.set(attempts.get() + 1);
                Err(Failure::Transient("offline".into()))
            },
        );
        assert_eq!(result.unwrap_err().message(), "offline");
        assert_eq!(attempts.get(), RETRY_DELAYS.len() + 1);

        attempts.set(0);
        let result: Result<(), _> = with_retries(
            &RETRY_DELAYS,
            |_| {},
            || {
                attempts.set(attempts.get() + 1);
                Err(Failure::Fatal("HTTP 404".into()))
            },
        );
        assert!(result.is_err());
        assert_eq!(attempts.get(), 1);
    }

    #[test]
    fn removes_stale_runtimes_but_keeps_current() {
        let root = temp_root();
        let current = root.join("current");
        for name in ["current", "old", ".install-abandoned"] {
            fs::create_dir(root.join(name)).unwrap();
        }
        remove_stale(&root, &current);
        let left: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(left, vec![std::ffi::OsString::from("current")]);
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
