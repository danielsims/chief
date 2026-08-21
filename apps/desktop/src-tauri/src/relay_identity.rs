use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use k256::{
    elliptic_curve::rand_core::{OsRng, RngCore},
    schnorr::{signature::hazmat::PrehashSigner, Signature, SigningKey},
};
use serde::Serialize;
use sha2::{Digest, Sha256};

const KEYCHAIN_SERVICE: &str = "com.danielsims.chief.relay";
const KEYCHAIN_ACCOUNT: &str = "device-nip98-private-key-v1";
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
    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::{get_generic_password, set_generic_password};

        if let Ok(value) = get_generic_password(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
            return SigningKey::from_bytes(&value)
                .map_err(|_| "Chief's saved relay device key is invalid.".to_string());
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

fn public_key_hex(key: &SigningKey) -> String {
    hex::encode(key.verifying_key().to_bytes())
}

#[tauri::command]
pub fn relay_public_key() -> Result<String, String> {
    signing_key().map(|key| public_key_hex(&key))
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

fn validate_relay_url(value: &str) -> Result<url::Url, String> {
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

#[cfg(test)]
mod tests {
    use super::validate_relay_url;

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
}
