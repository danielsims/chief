//! Agent-owned signing keys. A connection invitation is never a credential.
use base64::{engine::general_purpose::STANDARD, Engine};
use k256::{
    elliptic_curve::rand_core::OsRng,
    schnorr::{signature::hazmat::PrehashSigner, Signature, SigningKey},
};
use serde_json::json;
use sha2::{Digest, Sha256};

pub fn generate() -> String {
    hex::encode(SigningKey::random(&mut OsRng).to_bytes())
}
fn key(secret: &str) -> Result<SigningKey, String> {
    SigningKey::from_bytes(&hex::decode(secret).map_err(|_| "Invalid private agent key.")?)
        .map_err(|_| "Invalid private agent key.".into())
}
pub fn public(secret: &str) -> Result<String, String> {
    Ok(hex::encode(key(secret)?.verifying_key().to_bytes()))
}
pub fn sign(secret: &str, method: &str, url: &str, body: &str) -> Result<String, String> {
    crate::relay_http::relay_url(url)?;
    let key = key(secret)?;
    let pubkey = hex::encode(key.verifying_key().to_bytes());
    let mut tags = vec![
        vec!["u".to_string(), url.to_string()],
        vec!["method".to_string(), method.to_string()],
        vec!["request".to_string(), uuid::Uuid::new_v4().to_string()],
    ];
    if !body.is_empty() {
        tags.push(vec![
            "payload".to_string(),
            hex::encode(Sha256::digest(body.as_bytes())),
        ]);
    }
    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "Invalid system clock.")?
        .as_secs();
    let canonical = serde_json::to_vec(&json!([0, pubkey, created_at, 27235, tags, ""]))
        .map_err(|_| "Cannot encode signature.")?;
    let id = Sha256::digest(canonical);
    let signature: Signature = key.sign_prehash(&id).map_err(|_| "Cannot sign request.")?;
    let event = json!({"id":hex::encode(id),"pubkey":pubkey,"created_at":created_at,"kind":27235,"tags":tags,"content":"","sig":hex::encode(signature.to_bytes())});
    Ok(format!(
        "Nostr {}",
        STANDARD.encode(serde_json::to_vec(&event).map_err(|_| "Cannot encode signature.")?)
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    use k256::schnorr::signature::hazmat::PrehashVerifier;
    #[test]
    fn signature_uses_exact_event_digest() {
        let secret = generate();
        let auth = sign(&secret, "POST", "https://relay.example/v1/agent", "{}").unwrap();
        let event: serde_json::Value = serde_json::from_slice(
            &STANDARD
                .decode(auth.strip_prefix("Nostr ").unwrap())
                .unwrap(),
        )
        .unwrap();
        let id = hex::decode(event["id"].as_str().unwrap()).unwrap();
        let sig = Signature::try_from(
            hex::decode(event["sig"].as_str().unwrap())
                .unwrap()
                .as_slice(),
        )
        .unwrap();
        key(&secret)
            .unwrap()
            .verifying_key()
            .verify_prehash(&id, &sig)
            .unwrap();
        assert_eq!(event["pubkey"], public(&secret).unwrap());
    }
}
