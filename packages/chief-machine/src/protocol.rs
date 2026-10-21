//! The messages on a machine's lending socket, mirroring
//! `@chief/relay-contracts/web-machine`, and this machine's saved setup.

use serde::{Deserialize, Serialize};

/// A page an agent wants fetched.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchRequest {
    pub request_id: String,
    pub url: String,
    pub agent_id: String,
    pub requester_user_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "type", rename = "web.fetch.result")]
pub struct FetchResult {
    pub request_id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Who may use this machine. Paired machines choose between their owner's
/// agents and the whole workspace; selected people are set from the app.
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase", tag = "allow")]
pub enum Policy {
    Mine,
    Workspace,
}

#[derive(Serialize)]
#[serde(tag = "type", rename = "web.machine.policy")]
pub struct PolicyMessage {
    pub policy: Policy,
}

/// What `pair` saves, kept readable only by this machine's user.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub relay: String,
    pub workspace_id: String,
    pub machine_id: String,
    pub key: String,
    pub policy: Policy,
}

/// The pairing token the app shows: base64url JSON.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingToken {
    pub relay: String,
    pub workspace_id: String,
    pub code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Claimed {
    pub machine_id: String,
    pub key: String,
}

#[derive(Deserialize)]
pub struct Ticket {
    pub ticket: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub websocket_url: String,
}
