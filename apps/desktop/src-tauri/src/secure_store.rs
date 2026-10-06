//! Secrets Chief keeps on this computer: OAuth sessions, sign-in attempts and
//! relay signing keys. Each lives in the operating system's own protected
//! store, readable only by the signed-in user:
//!
//! - macOS: the login Keychain.
//! - Windows: encrypted with DPAPI for the current user, bound to its slot,
//!   and written under `%LOCALAPPDATA%\Chief\secrets`. Credential Manager is
//!   not used because it caps each secret at 2.5 KB, which a session with a
//!   refresh token can exceed.

/// Why a secret could not be read or written. Callers turn this into their
/// own user-facing message; nothing about the secret itself is exposed.
#[derive(Debug)]
pub(crate) struct SecureStoreError;

/// The secret in `service`/`account`, or `None` when there is none.
pub(crate) fn get(service: &str, account: &str) -> Result<Option<Vec<u8>>, SecureStoreError> {
    platform::get(service, account)
}

pub(crate) fn set(service: &str, account: &str, value: &[u8]) -> Result<(), SecureStoreError> {
    platform::set(service, account, value)
}

/// Removes the secret. Removing one that does not exist succeeds.
pub(crate) fn delete(service: &str, account: &str) -> Result<(), SecureStoreError> {
    platform::delete(service, account)
}

#[cfg(target_os = "macos")]
mod platform {
    use super::SecureStoreError;
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };

    const ITEM_NOT_FOUND: i32 = -25_300;

    pub(super) fn get(service: &str, account: &str) -> Result<Option<Vec<u8>>, SecureStoreError> {
        match get_generic_password(service, account) {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
            Err(_) => Err(SecureStoreError),
        }
    }

    pub(super) fn set(service: &str, account: &str, value: &[u8]) -> Result<(), SecureStoreError> {
        set_generic_password(service, account, value).map_err(|_| SecureStoreError)
    }

    pub(super) fn delete(service: &str, account: &str) -> Result<(), SecureStoreError> {
        match delete_generic_password(service, account) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == ITEM_NOT_FOUND => Ok(()),
            Err(_) => Err(SecureStoreError),
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::SecureStoreError;
    use sha2::{Digest, Sha256};
    use std::{fs, io::ErrorKind, path::PathBuf, ptr, slice};
    use windows_sys::Win32::{
        Foundation::{LocalFree, HLOCAL},
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };

    /// One file per secret, named by a hash so the service and account never
    /// appear on disk.
    fn path(service: &str, account: &str) -> Result<PathBuf, SecureStoreError> {
        let base = std::env::var_os("LOCALAPPDATA").ok_or(SecureStoreError)?;
        let name = hex::encode(Sha256::digest(slot(service, account)));
        Ok(PathBuf::from(base)
            .join("Chief")
            .join("secrets")
            .join(format!("{name}.bin")))
    }

    /// Mixed into the encryption so a blob copied into another slot will not
    /// decrypt there.
    fn slot(service: &str, account: &str) -> Vec<u8> {
        format!("{service}\0{account}").into_bytes()
    }

    fn blob(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB {
            cbData: bytes.len() as u32,
            pbData: bytes.as_ptr() as *mut u8,
        }
    }

    /// Copies DPAPI's output and frees the buffer it allocated.
    fn take(output: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        // SAFETY: DPAPI returned `cbData` bytes at `pbData`, allocated with
        // LocalAlloc; they are copied before being freed exactly once.
        unsafe {
            let bytes = slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            LocalFree(output.pbData as HLOCAL);
            bytes
        }
    }

    fn protect(value: &[u8], entropy: &[u8]) -> Result<Vec<u8>, SecureStoreError> {
        let input = blob(value);
        let entropy = blob(entropy);
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };
        // SAFETY: the input blobs borrow live slices; DPAPI allocates output.
        let ok = unsafe {
            CryptProtectData(
                &input,
                ptr::null(),
                &entropy,
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(SecureStoreError);
        }
        Ok(take(output))
    }

    fn unprotect(value: &[u8], entropy: &[u8]) -> Result<Vec<u8>, SecureStoreError> {
        let input = blob(value);
        let entropy = blob(entropy);
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };
        // SAFETY: as in `protect`.
        let ok = unsafe {
            CryptUnprotectData(
                &input,
                ptr::null_mut(),
                &entropy,
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(SecureStoreError);
        }
        Ok(take(output))
    }

    pub(super) fn get(service: &str, account: &str) -> Result<Option<Vec<u8>>, SecureStoreError> {
        let encrypted = match fs::read(path(service, account)?) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(SecureStoreError),
        };
        unprotect(&encrypted, &slot(service, account)).map(Some)
    }

    pub(super) fn set(service: &str, account: &str, value: &[u8]) -> Result<(), SecureStoreError> {
        let target = path(service, account)?;
        let directory = target.parent().ok_or(SecureStoreError)?;
        fs::create_dir_all(directory).map_err(|_| SecureStoreError)?;
        let encrypted = protect(value, &slot(service, account))?;
        // Write beside the target and rename over it, so a crash never leaves
        // half a secret behind.
        let staged = target.with_extension("tmp");
        fs::write(&staged, encrypted).map_err(|_| SecureStoreError)?;
        fs::rename(&staged, &target).map_err(|_| SecureStoreError)
    }

    pub(super) fn delete(service: &str, account: &str) -> Result<(), SecureStoreError> {
        match fs::remove_file(path(service, account)?) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(_) => Err(SecureStoreError),
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::SecureStoreError;

    pub(super) fn get(_: &str, _: &str) -> Result<Option<Vec<u8>>, SecureStoreError> {
        Err(SecureStoreError)
    }

    pub(super) fn set(_: &str, _: &str, _: &[u8]) -> Result<(), SecureStoreError> {
        Err(SecureStoreError)
    }

    pub(super) fn delete(_: &str, _: &str) -> Result<(), SecureStoreError> {
        Err(SecureStoreError)
    }
}
