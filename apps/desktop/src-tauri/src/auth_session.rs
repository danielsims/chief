use serde::{Deserialize, Serialize};

const KEYCHAIN_SERVICE: &str = "sh.heychief.desktop.auth";
const KEYCHAIN_ACCOUNT: &str = "oauth-session-v1";
const KEYCHAIN_ITEM_NOT_FOUND: i32 = -25_300;

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

#[tauri::command]
pub fn load_oauth_session() -> Result<Option<DesktopOAuthSession>, String> {
    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::get_generic_password;

        let value = match get_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
            Ok(value) => value,
            Err(error) if error.code() == KEYCHAIN_ITEM_NOT_FOUND => return Ok(None),
            Err(_) => {
                return Err("Chief could not read its OAuth session from Keychain.".to_string())
            }
        };
        let session: DesktopOAuthSession = serde_json::from_slice(&value)
            .map_err(|_| "Chief's saved OAuth session is invalid.".to_string())?;
        session.validate()?;
        return Ok(Some(session));
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Secure OAuth sessions are not available on this platform yet.".to_string())
    }
}

#[tauri::command]
pub fn store_oauth_session(session: DesktopOAuthSession) -> Result<(), String> {
    session.validate()?;

    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::set_generic_password;

        let value = serde_json::to_vec(&session)
            .map_err(|_| "Chief could not encode its OAuth session.".to_string())?;
        return set_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, &value)
            .map_err(|_| "Chief could not save its OAuth session in Keychain.".to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Secure OAuth sessions are not available on this platform yet.".to_string())
    }
}

#[tauri::command]
pub fn clear_oauth_session() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::delete_generic_password;

        return match delete_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
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
    use super::{DesktopOAuthSession, DesktopOAuthUser};

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
}
