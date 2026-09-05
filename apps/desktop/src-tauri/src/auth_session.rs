use serde::{Deserialize, Serialize};

const KEYCHAIN_SERVICE: &str = "sh.heychief.desktop.auth";
const LEGACY_KEYCHAIN_ACCOUNT: &str = "oauth-session-v1";
const KEYCHAIN_ITEM_NOT_FOUND: i32 = -25_300;
const OAUTH_ATTEMPT_TTL_MS: u64 = 10 * 60 * 1_000;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopOAuthUser {
    id: String,
    name: String,
    email: String,
    email_verified: bool,
    image: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopOAuthSession {
    token: String,
    refresh_token: Option<String>,
    expires_at: Option<u64>,
    user: DesktopOAuthUser,
    organization_id: Option<String>,
    last_validated: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopOAuthAttempt {
    state: String,
    verifier: String,
    relay_origin: String,
    auth_base_url: String,
    #[serde(default)]
    redirect_uri: Option<String>,
    created_at: u64,
}

impl DesktopOAuthAttempt {
    fn validate(&self) -> Result<(), String> {
        if self.state.len() < 16
            || self.state.len() > 128
            || !self
                .state
                .chars()
                .all(|character| character.is_ascii_alphanumeric())
        {
            return Err("Chief received an invalid OAuth state.".to_string());
        }
        if self.verifier.len() < 43 || self.verifier.len() > 128 {
            return Err("Chief received an invalid PKCE verifier.".to_string());
        }
        scoped_origin(&self.relay_origin)?;
        scoped_origin(&self.auth_base_url)?;
        if let Some(redirect_uri) = &self.redirect_uri {
            scoped_redirect_uri(redirect_uri)?;
        }
        Ok(())
    }

    fn is_expired(&self) -> bool {
        current_time_ms().saturating_sub(self.created_at) > OAUTH_ATTEMPT_TTL_MS
    }
}

impl DesktopOAuthSession {
    fn validate(&self) -> Result<(), String> {
        if self.token.is_empty() || self.token.len() > 32_768 {
            return Err("Chief received an invalid OAuth access token.".to_string());
        }
        if self
            .refresh_token
            .as_ref()
            .is_some_and(|token| token.is_empty() || token.len() > 32_768)
        {
            return Err("Chief received an invalid OAuth refresh token.".to_string());
        }
        if self.user.id.is_empty() || self.user.email.is_empty() {
            return Err("Chief received an invalid OAuth identity.".to_string());
        }
        Ok(())
    }
}

fn scoped_origin(relay_origin: &str) -> Result<(), String> {
    if relay_origin.len() > 2_048
        || !(relay_origin.starts_with("https://")
            || relay_origin.starts_with("http://localhost")
            || relay_origin.starts_with("http://127.0.0.1"))
    {
        return Err("Chief received an invalid relay session scope.".to_string());
    }
    Ok(())
}

fn scoped_redirect_uri(redirect_uri: &str) -> Result<(), String> {
    if redirect_uri.len() > 2_048
        || !(redirect_uri.starts_with("https://")
            || redirect_uri.starts_with("http://localhost")
            || redirect_uri.starts_with("http://127.0.0.1")
            || redirect_uri.starts_with("chief-desktop://"))
    {
        return Err("Chief received an invalid OAuth redirect.".to_string());
    }
    Ok(())
}

fn scoped_account(relay_origin: &str) -> Result<String, String> {
    scoped_origin(relay_origin)?;
    Ok(format!("oauth-session-v2:{relay_origin}"))
}

fn attempt_account(state: &str) -> Result<String, String> {
    if state.len() < 16
        || state.len() > 128
        || !state
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        return Err("Chief received an invalid OAuth state.".to_string());
    }
    Ok(format!("oauth-attempt-v1:{state}"))
}

fn current_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn store_oauth_attempt(attempt: DesktopOAuthAttempt) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || store_oauth_attempt_blocking(attempt))
        .await
        .map_err(|_| "Chief could not finish securing its sign-in attempt.".to_string())?
}

fn store_oauth_attempt_blocking(attempt: DesktopOAuthAttempt) -> Result<(), String> {
    attempt.validate()?;

    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::set_generic_password;

        let account = attempt_account(&attempt.state)?;
        let value = serde_json::to_vec(&attempt)
            .map_err(|_| "Chief could not encode its sign-in attempt.".to_string())?;
        return set_generic_password(KEYCHAIN_SERVICE, &account, &value)
            .map_err(|_| "Chief could not save its sign-in attempt in Keychain.".to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Secure OAuth attempts are not available on this platform yet.".to_string())
    }
}

#[tauri::command]
pub async fn load_oauth_attempt(state: String) -> Result<Option<DesktopOAuthAttempt>, String> {
    tauri::async_runtime::spawn_blocking(move || load_oauth_attempt_blocking(state))
        .await
        .map_err(|_| "Chief could not finish reading its sign-in attempt.".to_string())?
}

fn load_oauth_attempt_blocking(state: String) -> Result<Option<DesktopOAuthAttempt>, String> {
    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::{delete_generic_password, get_generic_password};

        let account = attempt_account(&state)?;
        let value = match get_generic_password(KEYCHAIN_SERVICE, &account) {
            Ok(value) => value,
            Err(error) if error.code() == KEYCHAIN_ITEM_NOT_FOUND => return Ok(None),
            Err(_) => {
                return Err("Chief could not read its sign-in attempt from Keychain.".to_string())
            }
        };
        let attempt: DesktopOAuthAttempt = serde_json::from_slice(&value)
            .map_err(|_| "Chief's saved sign-in attempt is invalid.".to_string())?;
        attempt.validate()?;
        if attempt.state != state || attempt.is_expired() {
            let _ = delete_generic_password(KEYCHAIN_SERVICE, &account);
            return Ok(None);
        }
        return Ok(Some(attempt));
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Secure OAuth attempts are not available on this platform yet.".to_string())
    }
}

#[tauri::command]
pub async fn clear_oauth_attempt(state: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || clear_oauth_attempt_blocking(state))
        .await
        .map_err(|_| "Chief could not finish clearing its sign-in attempt.".to_string())?
}

fn clear_oauth_attempt_blocking(state: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::delete_generic_password;

        let account = attempt_account(&state)?;
        return match delete_generic_password(KEYCHAIN_SERVICE, &account) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == KEYCHAIN_ITEM_NOT_FOUND => Ok(()),
            Err(_) => Err("Chief could not clear its sign-in attempt from Keychain.".to_string()),
        };
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Secure OAuth attempts are not available on this platform yet.".to_string())
    }
}

#[tauri::command]
pub async fn load_oauth_session(account: String) -> Result<Option<DesktopOAuthSession>, String> {
    tauri::async_runtime::spawn_blocking(move || load_oauth_session_blocking(account))
        .await
        .map_err(|_| "Chief could not finish reading its secure sign-in.".to_string())?
}

fn load_oauth_session_blocking(account: String) -> Result<Option<DesktopOAuthSession>, String> {
    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::{
            delete_generic_password, get_generic_password, set_generic_password,
        };

        let scoped = scoped_account(&account)?;
        let (value, migrated) = match get_generic_password(KEYCHAIN_SERVICE, &scoped) {
            Ok(value) => (value, false),
            Err(error) if error.code() == KEYCHAIN_ITEM_NOT_FOUND => {
                match get_generic_password(KEYCHAIN_SERVICE, LEGACY_KEYCHAIN_ACCOUNT) {
                    Ok(value) => (value, true),
                    Err(legacy_error) if legacy_error.code() == KEYCHAIN_ITEM_NOT_FOUND => {
                        return Ok(None)
                    }
                    Err(_) => {
                        return Err(
                            "Chief could not read its OAuth session from Keychain.".to_string()
                        )
                    }
                }
            }
            Err(_) => {
                return Err("Chief could not read its OAuth session from Keychain.".to_string())
            }
        };
        let session: DesktopOAuthSession = serde_json::from_slice(&value)
            .map_err(|_| "Chief's saved OAuth session is invalid.".to_string())?;
        session.validate()?;
        if migrated {
            set_generic_password(KEYCHAIN_SERVICE, &scoped, &value).map_err(|_| {
                "Chief could not migrate its OAuth session in Keychain.".to_string()
            })?;
            let _ = delete_generic_password(KEYCHAIN_SERVICE, LEGACY_KEYCHAIN_ACCOUNT);
        }
        return Ok(Some(session));
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Secure OAuth sessions are not available on this platform yet.".to_string())
    }
}

#[tauri::command]
pub async fn store_oauth_session(
    account: String,
    session: DesktopOAuthSession,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || store_oauth_session_blocking(account, session))
        .await
        .map_err(|_| "Chief could not finish saving its secure sign-in.".to_string())?
}

fn store_oauth_session_blocking(
    account: String,
    session: DesktopOAuthSession,
) -> Result<(), String> {
    session.validate()?;

    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::set_generic_password;

        let scoped = scoped_account(&account)?;
        let value = serde_json::to_vec(&session)
            .map_err(|_| "Chief could not encode its OAuth session.".to_string())?;
        return set_generic_password(KEYCHAIN_SERVICE, &scoped, &value)
            .map_err(|_| "Chief could not save its OAuth session in Keychain.".to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Secure OAuth sessions are not available on this platform yet.".to_string())
    }
}

#[tauri::command]
pub async fn clear_oauth_session(account: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || clear_oauth_session_blocking(account))
        .await
        .map_err(|_| "Chief could not finish clearing its secure sign-in.".to_string())?
}

fn clear_oauth_session_blocking(account: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::delete_generic_password;

        let scoped = scoped_account(&account)?;
        return match delete_generic_password(KEYCHAIN_SERVICE, &scoped) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == KEYCHAIN_ITEM_NOT_FOUND => Ok(()),
            Err(_) => Err("Chief could not clear its OAuth session from Keychain.".to_string()),
        };
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Secure OAuth sessions are not available on this platform yet.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{scoped_account, DesktopOAuthAttempt, DesktopOAuthSession, DesktopOAuthUser};

    fn valid_session() -> DesktopOAuthSession {
        DesktopOAuthSession {
            token: "access-token".to_string(),
            refresh_token: Some("refresh-token".to_string()),
            expires_at: Some(1_900_000_000_000),
            user: DesktopOAuthUser {
                id: "user_1".to_string(),
                name: "Chief User".to_string(),
                email: "user@example.com".to_string(),
                email_verified: true,
                image: None,
            },
            organization_id: Some("workspace_1".to_string()),
            last_validated: 1_800_000_000_000,
        }
    }

    #[test]
    fn accepts_a_bounded_session() {
        assert!(valid_session().validate().is_ok());
    }

    #[test]
    fn rejects_empty_or_oversized_credentials() {
        let mut session = valid_session();
        session.token.clear();
        assert!(session.validate().is_err());

        let mut session = valid_session();
        session.refresh_token = Some("x".repeat(32_769));
        assert!(session.validate().is_err());
    }

    #[test]
    fn scopes_sessions_to_secure_relay_origins() {
        assert!(scoped_account("https://relay.example").is_ok());
        assert!(scoped_account("http://localhost:8080").is_ok());
        assert!(scoped_account("http://relay.example").is_err());
    }

    #[test]
    fn validates_relay_scoped_pkce_attempts() {
        let attempt = DesktopOAuthAttempt {
            state: "a1b2c3d4e5f60708a1b2c3d4e5f60708".to_string(),
            verifier: "v".repeat(43),
            relay_origin: "https://relay.example".to_string(),
            auth_base_url: "https://accounts.example".to_string(),
            redirect_uri: Some("http://localhost:3000/auth/desktop".to_string()),
            created_at: 1_800_000_000_000,
        };
        assert!(attempt.validate().is_ok());

        let mut insecure = attempt;
        insecure.auth_base_url = "http://accounts.example".to_string();
        assert!(insecure.validate().is_err());
    }
}
