//! Private, atomic host state. Neither relay messages nor adapter output supply paths.
use serde::{de::DeserializeOwned, Serialize};
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub fn root() -> Result<PathBuf, String> {
    crate::machine::config_path()?
        .parent()
        .map(Path::to_path_buf)
        .ok_or("Missing config directory".into())
}

pub fn directory(path: &Path) -> Result<(), String> {
    if path
        .symlink_metadata()
        .is_ok_and(|m| m.file_type().is_symlink())
    {
        return Err("Host state directories must not be symbolic links.".into());
    }
    std::fs::create_dir_all(path).map_err(|_| "Cannot create private host directory.")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "Cannot protect host directory.")?;
    }
    Ok(())
}

pub fn save<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    directory(path.parent().ok_or("Missing state directory")?)?;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|_| "Cannot create host state.")?;
        file.write_all(&serde_json::to_vec_pretty(value).map_err(|_| "Cannot encode host state.")?)
            .map_err(|_| "Cannot write host state.")?;
        file.sync_all().map_err(|_| "Cannot flush host state.")?;
        std::fs::rename(&temporary, path).map_err(|_| "Cannot replace host state.")?;
        Ok(())
    })();
    let _ = std::fs::remove_file(temporary);
    result
}

pub fn load<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let metadata = path
        .symlink_metadata()
        .map_err(|_| "Host role is not configured.")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 1_048_576 {
        return Err("Invalid host state file.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err("Host state must be readable only by its owner (chmod 600).".into());
        }
    }
    serde_json::from_slice(&std::fs::read(path).map_err(|_| "Cannot read host state.")?)
        .map_err(|_| "Invalid host state JSON.".into())
}

pub fn lock(name: &str) -> Result<File, String> {
    use fs2::FileExt;
    let root = root()?;
    directory(&root)?;
    let mut options = OpenOptions::new();
    options.create(true).truncate(false).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let file = options
        .open(root.join(format!("{name}.lock")))
        .map_err(|_| "Cannot open service lock.")?;
    file.try_lock_exclusive()
        .map_err(|_| "This role is already running in another Chief host.")?;
    Ok(file)
}
