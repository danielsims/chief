use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use k256::{
    elliptic_curve::rand_core::{OsRng, RngCore},
    schnorr::{signature::hazmat::PrehashSigner, Signature, SigningKey},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

const KEYCHAIN_SERVICE: &str = "com.danielsims.chief.relay";
const KEYCHAIN_ACCOUNT: &str = "device-nip98-private-key-v1";
const AGENT_KEYCHAIN_SERVICE: &str = "com.danielsims.chief.agent-identity";
const KEYCHAIN_ITEM_NOT_FOUND: i32 = -25_300;
const NIP98_KIND: u32 = 27_235;

#[derive(Serialize)]
struct Nip98Event {
    id: String,
    pubkey: String,
    content: &'static str,
    kind: u32,
    created_at: u64,
    tags: Vec<Vec<String>>,
    sig: String,
}

fn signing_key() -> Result<SigningKey, String> {
    static SIGNING_KEY: OnceLock<Result<SigningKey, String>> = OnceLock::new();
    SIGNING_KEY.get_or_init(load_signing_key).clone()
}

fn load_signing_key() -> Result<SigningKey, String> {
    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::{get_generic_password, set_generic_password};

        match get_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
            Ok(value) => {
                return SigningKey::from_bytes(&value)
                    .map_err(|_| "Chief's saved relay device key is invalid.".to_string())
            }
            Err(error) if error.code() == KEYCHAIN_ITEM_NOT_FOUND => {}
            Err(_) => {
                return Err("Chief could not read its relay device key from Keychain.".to_string())
            }
        }
        let generated = SigningKey::random(&mut OsRng);
        set_generic_password(
            KEYCHAIN_SERVICE,
            KEYCHAIN_ACCOUNT,
            generated.to_bytes().as_slice(),
        )
        .map_err(|_| "Chief could not save its relay device key in Keychain.".to_string())?;
        return Ok(generated);
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Secure relay device keys are not available on this platform yet.".to_string())
    }
}

pub(crate) fn agent_signing_key(
    relay_url: &str,
    workspace_id: &str,
    agent_id: &str,
) -> Result<SigningKey, String> {
    validate_relay_url(relay_url)?;
    validate_identifier(workspace_id, "workspace")?;
    validate_identifier(agent_id, "agent")?;

    #[cfg(target_os = "macos")]
    {
        static AGENT_KEYS: OnceLock<Mutex<HashMap<String, Result<SigningKey, String>>>> =
            OnceLock::new();
        let account = agent_keychain_account(relay_url, workspace_id, agent_id);
        let mut keys = AGENT_KEYS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|_| "Chief could not access its cached agent identities.".to_string())?;
        if let Some(key) = keys.get(&account) {
            return key.clone();
        }
        let key = load_agent_signing_key(&account);
        keys.insert(account, key.clone());
        return key;
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Secure agent identities are not available on this platform yet.".to_string())
    }
}

#[cfg(target_os = "macos")]
fn load_agent_signing_key(account: &str) -> Result<SigningKey, String> {
    use security_framework::passwords::{get_generic_password, set_generic_password};

    match get_generic_password(AGENT_KEYCHAIN_SERVICE, account) {
        Ok(value) => {
            return SigningKey::from_bytes(&value)
                .map_err(|_| "Chief's saved agent identity is invalid.".to_string())
        }
        Err(error) if error.code() == KEYCHAIN_ITEM_NOT_FOUND => {}
        Err(_) => return Err("Chief could not read the agent identity from Keychain.".to_string()),
    }
    let generated = SigningKey::random(&mut OsRng);
    set_generic_password(
        AGENT_KEYCHAIN_SERVICE,
        account,
        generated.to_bytes().as_slice(),
    )
    .map_err(|_| "Chief could not save the agent identity in Keychain.".to_string())?;
    Ok(generated)
}

fn agent_keychain_account(relay_url: &str, workspace_id: &str, agent_id: &str) -> String {
    let scope = format!(
        "{}\0{}\0{}",
        normalized_relay_origin(relay_url),
        workspace_id,
        agent_id
    );
    format!(
        "agent-nip98-private-key-v1-{}",
        hex::encode(Sha256::digest(scope.as_bytes()))
    )
}

fn normalized_relay_origin(value: &str) -> String {
    let Ok(mut parsed) = url::Url::parse(value) else {
        return value.to_string();
    };
    parsed.set_path("/");
    parsed.set_query(None);
    parsed.set_fragment(None);
    parsed.to_string().trim_end_matches('/').to_string()
}

pub(crate) fn validate_identifier(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
    {
        return Err(format!("The {label} identifier is invalid."));
    }
    Ok(())
}

fn public_key_hex(key: &SigningKey) -> String {
    hex::encode(key.verifying_key().to_bytes())
}

#[tauri::command]
pub fn relay_public_key() -> Result<String, String> {
    signing_key().map(|key| public_key_hex(&key))
}

#[tauri::command]
pub fn relay_agent_public_key(
    relay_url: String,
    workspace_id: String,
    agent_id: String,
) -> Result<String, String> {
    agent_signing_key(&relay_url, &workspace_id, &agent_id).map(|key| public_key_hex(&key))
}

#[tauri::command]
pub fn relay_nip98_authorization(
    method: String,
    url: String,
    body: String,
) -> Result<String, String> {
    validate_relay_url(&url)?;
    let key = signing_key()?;
    let pubkey = public_key_hex(&key);
    let method = method.to_uppercase();
    let mut tags = vec![
        vec!["u".to_string(), url],
        vec!["method".to_string(), method],
    ];
    if !body.is_empty() {
        tags.push(vec![
            "payload".to_string(),
            hex::encode(Sha256::digest(body.as_bytes())),
        ]);
    }
    let mut request_nonce = [0_u8; 16];
    OsRng.fill_bytes(&mut request_nonce);
    tags.push(vec!["request".to_string(), hex::encode(request_nonce)]);
    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "The system clock is invalid.".to_string())?
        .as_secs();
    let canonical = serde_json::to_vec(&serde_json::json!([
        0, pubkey, created_at, NIP98_KIND, tags, ""
    ]))
    .map_err(|_| "Chief could not encode relay authorization.".to_string())?;
    let id = Sha256::digest(canonical);
    // `id` is already the SHA-256 NIP-01 event digest. The ordinary `Signer`
    // implementation hashes its input once more; Nostr/BIP-340 requires the
    // exact 32-byte event id here, matching the relay's noble verification.
    let signature: Signature = key
        .sign_prehash(&id)
        .map_err(|_| "Chief could not sign relay authorization.".to_string())?;
    let event = Nip98Event {
        id: hex::encode(id),
        pubkey,
        content: "",
        kind: NIP98_KIND,
        created_at,
        tags,
        sig: hex::encode(signature.to_bytes()),
    };
    let json = serde_json::to_vec(&event)
        .map_err(|_| "Chief could not encode relay authorization.".to_string())?;
    Ok(format!("Nostr {}", BASE64.encode(json)))
}

pub(crate) fn validate_relay_url(value: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(value).map_err(|_| "The relay URL is invalid.".to_string())?;
    let loopback = match parsed.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    };
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
        return Err(
            "Relay requests must use HTTPS; HTTP is allowed only on this device.".to_string(),
        );
    }
    Ok(parsed)
}

pub(crate) fn agent_private_key_hex(
    relay_url: &str,
    workspace_id: &str,
    agent_id: &str,
) -> Result<String, String> {
    agent_signing_key(relay_url, workspace_id, agent_id).map(|key| hex::encode(key.to_bytes()))
}

#[cfg(test)]
mod tests {
    use super::{agent_keychain_account, validate_identifier, validate_relay_url};

    #[test]
    fn accepts_https_and_loopback_http() {
        assert!(validate_relay_url("https://relay.example/v1/workspaces").is_ok());
        assert!(validate_relay_url("http://localhost:8787/health").is_ok());
        assert!(validate_relay_url("http://127.0.0.1:8787/health").is_ok());
        assert!(validate_relay_url("http://[::1]:8787/health").is_ok());
    }

    #[test]
    fn rejects_insecure_or_non_http_urls() {
        assert!(validate_relay_url("http://relay.example/v1/workspaces").is_err());
        assert!(validate_relay_url("file:///tmp/relay").is_err());
    }

    #[test]
    fn scopes_agent_keys_to_relay_workspace_and_agent() {
        let chief = agent_keychain_account("https://relay.example/path", "workspace-a", "chief");
        let repeated = agent_keychain_account("https://relay.example", "workspace-a", "chief");
        let engineer = agent_keychain_account("https://relay.example", "workspace-a", "engineer");
        let other_workspace =
            agent_keychain_account("https://relay.example", "workspace-b", "chief");
        assert_eq!(chief, repeated);
        assert_eq!(chief.len(), "agent-nip98-private-key-v1-".len() + 64);
        assert_ne!(chief, engineer);
        assert_ne!(chief, other_workspace);
    }

    #[test]
    fn validates_agent_key_scope_identifiers() {
        assert!(validate_identifier("workspace-a", "workspace").is_ok());
        assert!(validate_identifier("engineer", "agent").is_ok());
        assert!(validate_identifier("../other", "agent").is_err());
    }
}
