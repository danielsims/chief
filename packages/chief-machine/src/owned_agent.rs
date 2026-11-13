//! Approval-bound agent connections for local and independent cloud hosts.
use crate::agent_adapter::{self, Adapter, TurnInput};
use crate::{agent_identity, host_storage, relay_http};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::PathBuf, time::Duration};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    id: String,
    relay: String,
    workspace_id: String,
    name: String,
    secret_key: String,
    agent_id: Option<String>,
    device_code: Option<String>,
    handle: Option<String>,
    #[serde(default)]
    cursor: u64,
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    adapter: Option<Adapter>,
    #[serde(default)]
    pending: Option<Value>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Invitation {
    relay: String,
    workspace_id: String,
    code: String,
}
fn directory() -> Result<PathBuf, String> {
    Ok(host_storage::root()?.join("owned-agents"))
}
fn path(id: &str) -> Result<PathBuf, String> {
    Uuid::parse_str(id).map_err(|_| "Use a binding ID from chief-machine agent list.")?;
    Ok(directory()?.join(format!("{id}.json")))
}
fn save(b: &Binding) -> Result<(), String> {
    host_storage::save(&path(&b.id)?, b)
}
fn load(id: &str) -> Result<Binding, String> {
    host_storage::load(&path(id)?)
}
fn all() -> Result<Vec<Binding>, String> {
    let dir = directory()?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in std::fs::read_dir(dir).map_err(|_| "Cannot list agents.")? {
        let p = entry.map_err(|_| "Cannot read agent.")?.path();
        if p.extension().is_some_and(|e| e == "json") {
            out.push(host_storage::load(&p)?);
        }
    }
    Ok(out)
}
fn invitation(link: &str) -> Result<Invitation, String> {
    if link.len() > 4096 {
        return Err("Invitation is too long.".into());
    }
    let url = url::Url::parse(link).map_err(|_| "Use the complete Chief invitation link.")?;
    let fragment = url
        .fragment()
        .ok_or("Use the complete link, including its #fragment.")?;
    let decoded = URL_SAFE_NO_PAD
        .decode(fragment)
        .map_err(|_| "Invalid invitation.")?;
    let invite: Invitation = serde_json::from_slice(&decoded).map_err(|_| "Invalid invitation.")?;
    let mut clean = url.clone();
    clean.set_fragment(None);
    relay_http::same_origin(&clean, &invite.relay)?;
    if clean.path() != "/connect"
        || clean.query().is_some()
        || invite.code.len() < 32
        || invite.code.len() > 128
    {
        return Err("Invalid connection invitation.".into());
    }
    if invite.workspace_id.is_empty()
        || invite.workspace_id.len() > 128
        || !invite
            .workspace_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Invalid workspace ID.".into());
    }
    Ok(invite)
}
async fn signed(
    b: &Binding,
    method: reqwest::Method,
    suffix: &str,
    body: Option<Value>,
    credential: Option<&str>,
) -> Result<Value, String> {
    let base = relay_http::relay_url(&b.relay)?;
    let url = base
        .join(&format!(
            "/v1/workspaces/{}/agent-connect/{}",
            b.workspace_id, suffix
        ))
        .map_err(|_| "Invalid agent URL.")?;
    relay_http::same_origin(&base, url.as_str())?;
    let body = body
        .map(|v| serde_json::to_string(&v))
        .transpose()
        .map_err(|_| "Cannot encode request.")?
        .unwrap_or_default();
    let auth = agent_identity::sign(&b.secret_key, method.as_str(), url.as_str(), &body)?;
    let mut req = relay_http::client()?
        .request(method, url)
        .header("authorization", auth);
    if !body.is_empty() {
        req = req.header("content-type", "application/json").body(body);
    }
    if let Some(id) = &b.agent_id {
        req = req.header("x-chief-owned-agent-id", id);
    }
    if let Some(token) = credential {
        req = req.header("x-chief-agent-credential", token);
    }
    let mut response = req
        .send()
        .await
        .map_err(|_| "Cannot reach Chief. Check your connection.")?;
    let status = response.status();
    let mut bytes = vec![];
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Chief response interrupted.")?
    {
        if bytes.len() + chunk.len() > 1_048_576 {
            return Err("Chief response exceeded the limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Chief returned an invalid response.")?;
    if !status.is_success() && value["error"]["code"] == "slow_down" {
        return Err(format!(
            "slow_down:{}:Wait before checking again.",
            value["error"]["details"]["interval"].as_u64().unwrap_or(10)
        ));
    }
    if !status.is_success() {
        return Err(format!(
            "{}: {}",
            value["error"]["code"].as_str().unwrap_or("request_failed"),
            value["error"]["message"]
                .as_str()
                .unwrap_or("Chief refused the request.")
        ));
    }
    Ok(value)
}
async fn credential(b: &Binding) -> Result<String, String> {
    let challenge = signed(b, reqwest::Method::POST, "challenge", None, None).await?;
    let result = signed(
        b,
        reqwest::Method::POST,
        "credential",
        Some(json!({"challenge":challenge["challenge"]})),
        None,
    )
    .await?;
    Ok(result["credential"]
        .as_str()
        .ok_or("Chief did not issue a credential.")?
        .to_string())
}
async fn call(
    b: &Binding,
    method: reqwest::Method,
    suffix: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let token = credential(b).await?;
    signed(b, method, suffix, body, Some(&token)).await
}
const HELP:&str="chief-machine agent — connect an agent from any local or cloud host\n\n  connect --link <invitation-link> --name <agent-name> [--provider chatgpt|claude|grok|muse|other]\n  status <binding-id>               Check whether the human has approved\n  wait <binding-id>                 Wait for human approval\n  list                             List connections without credentials\n  messages <binding-id> [channel]   Read the assigned channels\n  post <binding-id> <channel> [thread-id]  Send a message from stdin\n  adapter <binding-id> <file>       Configure a local JSON subprocess adapter\n  enable <binding-id>               Handle human mentions with that adapter\n  disable <binding-id>              Stop automatic replies\n  leave <binding-id>                Revoke and remove this connection\n\nThe human must approve every agent. Invitations grant no channel access on their own.\nKeys remain in private local host storage. chief-machine serve runs explicitly enabled adapters and optionally paired machine capacity.";
pub async fn cli(args: &[String]) -> Result<(), String> {
    match args.first().map(String::as_str) {
        None | Some("--help" | "-h") => {
            println!("{HELP}");
            Ok(())
        }
        Some("connect") => connect(&args[1..]).await,
        Some("list") => {
            for b in all()? {
                println!(
                    "{}  {}  {}",
                    b.id,
                    b.handle.as_deref().unwrap_or(&b.name),
                    if b.agent_id.is_some() {
                        "connected"
                    } else {
                        "pending"
                    }
                );
            }
            Ok(())
        }
        Some("status" | "wait") => {
            let id = args.get(1).ok_or("Choose a binding ID.")?;
            let mut b = load(id)?;
            let until = std::time::Instant::now() + Duration::from_secs(600);
            loop {
                match approved(&mut b).await {
                    Ok(()) => {
                        println!("Connected as {}.", b.handle.as_deref().unwrap_or(&b.name));
                        return Ok(());
                    }
                    Err(e)
                        if args[0] == "wait"
                            && (e.starts_with("authorization_pending:")
                                || e.starts_with("slow_down:"))
                            && std::time::Instant::now() < until =>
                    {
                        let delay = approval_poll_delay(&e);
                        tokio::time::sleep(Duration::from_secs(delay)).await;
                    }
                    // Accepted to take part through the person's own device, so
                    // this host keeps no identity.
                    Err(e) if e.starts_with("joined_on_device: ") => {
                        println!("{}", &e["joined_on_device: ".len()..]);
                        let _ = std::fs::remove_file(path(id)?);
                        return Ok(());
                    }
                    Err(e) => return Err(e),
                }
            }
        }
        Some("messages") => {
            let b = load(args.get(1).ok_or("Choose a binding ID.")?)?;
            let suffix = if let Some(channel) = args.get(2) {
                format!(
                    "messages?limit=20&channel={}",
                    url::form_urlencoded::byte_serialize(channel.as_bytes()).collect::<String>()
                )
            } else {
                "messages?limit=20".into()
            };
            let page = call(&b, reqwest::Method::GET, &suffix, None).await?;
            println!(
                "{}",
                serde_json::to_string_pretty(&page).map_err(|_| "Invalid message page.")?
            );
            Ok(())
        }
        Some("post") => {
            use tokio::io::AsyncReadExt;
            let b = load(args.get(1).ok_or("Choose a binding ID.")?)?;
            let channel = args.get(2).ok_or("Choose a channel ID.")?;
            let mut body = String::new();
            tokio::io::stdin()
                .take(32_001)
                .read_to_string(&mut body)
                .await
                .map_err(|_| "Cannot read message stdin.")?;
            if body.trim().is_empty() || body.chars().count() > 8000 {
                return Err("Messages must be 1–8000 characters.".into());
            }
            let mut payload =
                json!({"channelId":channel,"body":body,"idempotencyKey":Uuid::new_v4()});
            if let Some(thread) = args.get(3) {
                Uuid::parse_str(thread).map_err(|_| "Invalid thread ID.")?;
                payload["threadRootId"] = json!(thread);
            }
            call(&b, reqwest::Method::POST, "messages", Some(payload)).await?;
            println!("Message sent.");
            Ok(())
        }
        Some("adapter" | "enable" | "disable") => {
            let id = args.get(1).ok_or("Choose a binding ID.")?;
            let _lock = host_storage::lock(&format!("owned-agent-{id}"))?;
            let mut b = load(id)?;
            match args[0].as_str() {
                "adapter" => {
                    let adapter: Adapter = serde_json::from_slice(
                        &std::fs::read(args.get(2).ok_or("Choose an adapter file.")?)
                            .map_err(|_| "Cannot read adapter file.")?,
                    )
                    .map_err(|_| "Invalid adapter JSON.")?;
                    agent_adapter::validate(&adapter)?;
                    b.adapter = Some(adapter);
                }
                "enable" => {
                    if b.adapter.is_none() || b.agent_id.is_none() {
                        return Err(
                            "Connect and configure an adapter before enabling replies.".into()
                        );
                    }
                    b.enabled = true;
                }
                _ => {
                    b.enabled = false;
                    b.pending = None;
                }
            }
            save(&b)?;
            println!("Agent settings saved.");
            Ok(())
        }
        Some("leave") => {
            let id = args.get(1).ok_or("Choose a binding ID.")?;
            let b = load(id)?;
            if b.agent_id.is_some() {
                call(&b, reqwest::Method::POST, "leave", None).await?;
            }
            std::fs::remove_file(path(id)?).map_err(|_| "Cannot remove local agent identity.")?;
            println!("Disconnected.");
            Ok(())
        }
        Some("join") => Err(
            "Guest invitations were removed. Ask for a new setup prompt and use agent connect."
                .into(),
        ),
        _ => Err(HELP.into()),
    }
}
async fn connect(args: &[String]) -> Result<(), String> {
    let mut link = None;
    let mut name = None;
    let mut provider = "other".to_string();
    let mut index = 0;
    while index < args.len() {
        let val = args
            .get(index + 1)
            .ok_or("Connection options need a value.")?
            .clone();
        match args[index].as_str() {
            "--link" => link = Some(val),
            "--name" => name = Some(val),
            "--provider" => provider = val,
            _ => return Err("Unknown connection option.".into()),
        };
        index += 2;
    }
    let invite = invitation(&link.ok_or("Paste the invitation with --link.")?)?;
    let name = name.ok_or("Choose your agent name with --name.")?;
    if !["chatgpt", "claude", "codex", "grok", "muse", "other"].contains(&provider.as_str()) {
        return Err("Unknown provider. Use other for an independent cloud host.".into());
    }
    let mut b = Binding {
        id: Uuid::new_v4().to_string(),
        relay: invite.relay,
        workspace_id: invite.workspace_id,
        name,
        secret_key: agent_identity::generate(),
        agent_id: None,
        device_code: None,
        handle: None,
        cursor: 0,
        enabled: false,
        adapter: None,
        pending: None,
    };
    let result=signed(&b,reqwest::Method::POST,"connect",Some(json!({"code":invite.code,"name":b.name,"provider":provider,"publicKey":agent_identity::public(&b.secret_key)?})),None).await?;
    b.device_code = Some(
        result["device_code"]
            .as_str()
            .ok_or("Chief did not return a request.")?
            .to_string(),
    );
    save(&b)?;
    println!("Requested to join Chief. The human must approve in the app.\nVerification code: {}\nBinding: {}\nNext: chief-machine agent wait {}",result["user_code"].as_str().unwrap_or("unavailable"),b.id,b.id);
    Ok(())
}
fn approval_poll_delay(error: &str) -> u64 {
    if error.starts_with("slow_down:") {
        error
            .split(':')
            .nth(1)
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(10)
            .clamp(6, 600)
    } else {
        6
    }
}
fn channel_context(messages: &[Value], message: &Value, cursor: u64) -> Vec<Value> {
    messages
        .iter()
        .filter(|m| {
            m["channel"]["id"] == message["channel"]["id"]
                && m["cursor"].as_u64().unwrap_or(u64::MAX) <= cursor
        })
        .cloned()
        .collect()
}
async fn approved(b: &mut Binding) -> Result<(), String> {
    if b.agent_id.is_some() {
        call(b, reqwest::Method::GET, "self", None).await?;
        return Ok(());
    }
    let result=signed(b,reqwest::Method::POST,"token",Some(json!({"device_code":b.device_code.as_ref().ok_or("This request is unavailable. Connect again.")?})),None).await?;
    b.agent_id = Some(
        result["agentId"]
            .as_str()
            .ok_or("Chief did not approve the request.")?
            .to_string(),
    );
    b.handle = Some(
        result["handle"]
            .as_str()
            .ok_or("Chief did not return a handle.")?
            .to_string(),
    );
    b.device_code = None;
    save(b)
}

pub async fn serve_host() -> Result<(), String> {
    let _lock = host_storage::lock("serve")?;
    let bindings = all()?;
    let machine = crate::machine::load().is_ok();
    if !machine && bindings.is_empty() {
        return Err("No roles configured. Connect an agent or pair a machine first.".into());
    }
    let mut tasks = tokio::task::JoinSet::new();
    if machine {
        tasks.spawn(async { crate::machine::serve().await });
    }
    for b in bindings {
        tasks.spawn(async move { serve_binding(b.id).await });
    }
    loop {
        tokio::select! {_=tokio::signal::ctrl_c()=>{tasks.abort_all();while tasks.join_next().await.is_some(){}return Ok(())},result=tasks.join_next()=>match result {Some(Ok(Err(e)))=>eprintln!("Host role stopped: {e}"),Some(Err(_))=>eprintln!("Host role stopped unexpectedly."),Some(Ok(Ok(())))=>{},None=>return Ok(())}}
    }
}
fn progress(b: &mut Binding) -> Result<(), String> {
    let _lock = host_storage::lock(&format!("owned-agent-{}", b.id))?;
    let current = load(&b.id)?;
    b.enabled = current.enabled;
    b.adapter = current.adapter;
    if !b.enabled {
        b.pending = None;
    }
    save(b)
}
async fn serve_binding(id: String) -> Result<(), String> {
    let mut failures = 0;
    loop {
        let mut b = match load(&id) {
            Ok(b) => b,
            Err(_) => return Ok(()),
        };
        if !b.enabled || b.agent_id.is_none() {
            tokio::time::sleep(Duration::from_secs(3)).await;
            continue;
        }
        match poll(&mut b).await {
            Ok(()) => failures = 0,
            Err(e) => {
                failures += 1;
                eprintln!("Agent {}: {e}", b.name);
                if failures >= 5 {
                    let _lock = host_storage::lock(&format!("owned-agent-{id}"))?;
                    let mut current = load(&id)?;
                    current.enabled = false;
                    current.pending = None;
                    save(&current)?;
                    eprintln!("Automatic replies stopped after repeated failures. Resolve the issue and enable the agent again.");
                    failures = 0;
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}
async fn poll(b: &mut Binding) -> Result<(), String> {
    if let Some(pending) = b.pending.clone() {
        if load(&b.id)?.enabled {
            call(b, reqwest::Method::POST, "messages", Some(pending)).await?;
        }
        b.pending = None;
        progress(b)?;
    }
    if !b.enabled {
        return Ok(());
    }
    let page = call(
        b,
        reqwest::Method::GET,
        &format!("messages?after={}&limit=20", b.cursor),
        None,
    )
    .await?;
    let messages = page["messages"]
        .as_array()
        .ok_or("Chief returned an invalid message page.")?;
    for message in messages {
        let cursor = message["cursor"]
            .as_u64()
            .ok_or("Invalid message cursor.")?;
        if message["wakeReason"].is_null() || message["author"]["kind"] != "person" {
            b.cursor = b.cursor.max(cursor);
            progress(b)?;
            continue;
        }
        let current = load(&b.id)?;
        if !current.enabled {
            return Ok(());
        }
        let adapter = current.adapter.as_ref().ok_or("No adapter configured.")?;
        let message_id = message["id"].as_str().ok_or("Invalid message ID.")?;
        let request_id = Uuid::new_v5(
            &Uuid::NAMESPACE_URL,
            format!("chief:{}:{message_id}", b.id).as_bytes(),
        )
        .to_string();
        let input = TurnInput {
            protocol_version: 1,
            request_id: request_id.clone(),
            message: message.clone(),
            context: channel_context(messages, message, cursor),
        };
        let turn = agent_adapter::run(adapter, &input);
        tokio::pin!(turn);
        let body = loop {
            tokio::select! {result=&mut turn=>break result?,_=tokio::time::sleep(Duration::from_secs(2))=>{if !load(&b.id)?.enabled{return Ok(())}}}
        };
        if body.trim().is_empty() || body.chars().count() > 8000 {
            return Err("Adapter reply exceeds the allowed message size.".into());
        }
        if !load(&b.id)?.enabled {
            return Ok(());
        }
        b.pending = Some(
            json!({"channelId":message["channel"]["id"],"threadRootId":message["threadRootId"].as_str().unwrap_or(message_id),"body":body,"idempotencyKey":request_id}),
        );
        b.cursor = b.cursor.max(cursor);
        progress(b)?;
        if let Some(pending) = b.pending.clone() {
            if b.enabled {
                call(b, reqwest::Method::POST, "messages", Some(pending)).await?;
            }
            b.pending = None;
            progress(b)?;
        }
    }
    b.cursor = page["cursor"]
        .as_u64()
        .ok_or("Invalid page cursor.")?
        .max(b.cursor);
    progress(b)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn polling_honors_server_slow_down_interval() {
        assert_eq!(approval_poll_delay("slow_down:20:Wait"), 20);
        assert_eq!(approval_poll_delay("authorization_pending:Wait"), 6);
    }
    #[test]
    fn adapter_context_cannot_cross_channel_boundaries() {
        let messages = vec![
            json!({"channel":{"id":"general"},"cursor":1,"body":"public"}),
            json!({"channel":{"id":"private"},"cursor":2,"body":"private"}),
            json!({"channel":{"id":"general"},"cursor":3,"body":"future"}),
        ];
        let context = channel_context(&messages, &messages[0], 2);
        assert_eq!(context, vec![messages[0].clone()]);
    }
    #[test]
    fn invitations_pin_origin_and_validate_workspace() {
        let payload = json!({"relay":"https://chief.example","workspaceId":format!("workspace-{}",Uuid::new_v4()),"code":"a".repeat(43)});
        let link = format!(
            "https://chief.example/connect#{}",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap())
        );
        assert!(invitation(&link).is_ok());
        assert!(invitation(&link.replace(
            "https://chief.example/connect",
            "https://attacker.example/connect"
        ))
        .is_err());
        assert!(invitation("http://chief.example/connect#bad").is_err());
        assert!(invitation("https://chief.example/connect").is_err());
    }
}
