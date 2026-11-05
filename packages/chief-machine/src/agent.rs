//! Channel membership is independent from machine enrollment. Relay tokens stay here.
use crate::{
    agent_adapter::{self, Adapter, TurnInput},
    host_storage, relay_http,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::PathBuf, time::Duration};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub id: String,
    pub name: String,
    pub api: String,
    pub token: String,
    #[serde(default)]
    pub cursor: u64,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub allow_agent_mentions: bool,
    #[serde(default)]
    pub failures: u8,
    pub adapter: Option<Adapter>,
    pub pending: Option<PendingReply>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingReply {
    request_id: String,
    thread_root_id: String,
    body: String,
    cursor: u64,
}

#[derive(Deserialize)]
struct Joined {
    token: String,
    guest: Guest,
    api: Api,
}
#[derive(Deserialize)]
struct Guest {
    id: String,
    name: String,
}
#[derive(Deserialize)]
struct Api {
    base: String,
}
#[derive(Deserialize)]
struct Page {
    messages: Vec<Message>,
    cursor: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Message {
    id: String,
    thread_root_id: Option<String>,
    body: String,
    cursor: u64,
    author: Author,
    #[serde(default)]
    wake_reason: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Author {
    kind: String,
    name: String,
    you: bool,
}

fn bindings_dir() -> Result<PathBuf, String> {
    Ok(host_storage::root()?.join("agents"))
}
fn path(id: &str) -> Result<PathBuf, String> {
    if Uuid::parse_str(id).is_err() {
        return Err("Use a binding ID from `chief-machine agent list`.".into());
    }
    Ok(bindings_dir()?.join(format!("{id}.json")))
}
fn store(binding: &Binding) -> Result<(), String> {
    host_storage::save(&path(&binding.id)?, binding)
}
// Cursor/pending writes must never resurrect an opt-in changed by the CLI
// while a network request or adapter was in flight.
fn progress(binding: &mut Binding) -> Result<(), String> {
    let _lock = host_storage::lock(&format!("agent-{}", binding.id))?;
    let current = load(&binding.id)?;
    binding.enabled &= current.enabled;
    if !binding.enabled {
        binding.pending = None;
    }
    binding.adapter = current.adapter;
    binding.allow_agent_mentions = current.allow_agent_mentions;
    store(binding)
}
fn load(id: &str) -> Result<Binding, String> {
    host_storage::load(&path(id)?)
}
fn all() -> Result<Vec<Binding>, String> {
    let dir = bindings_dir()?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut result = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|_| "Cannot list channel bindings.")? {
        let entry = entry.map_err(|_| "Cannot read channel binding.")?;
        if entry.path().extension().is_some_and(|v| v == "json") {
            result.push(host_storage::load(&entry.path())?);
        }
    }
    Ok(result)
}

const HELP: &str = "chief-machine agent — connect an existing agent to one invited channel

  join <invite-url> --name <name> [--provider other] [--model <model>]
  list                             Show bindings without credentials
  messages <binding-id>            Read a small page without advancing the listener
  post <binding-id> <thread-id>     Read a reply from stdin and send it to that thread
  adapter <binding-id> <file>       Save a local JSON adapter config (absolute argv/cwd)
  enable <binding-id>              Start handling human mentions with the saved adapter
  disable <binding-id>             Stop this binding, including a running turn
  leave <binding-id>               Revoke membership, then remove saved credentials

chief-machine serve runs configured roles. Merely joining a channel never offers this machine.
Adapter output is versioned JSON containing protocolVersion, requestId and body only.";

pub async fn cli(args: &[String]) -> Result<(), String> {
    match args.first().map(String::as_str) {
        Some("join") => join(&args[1..]).await,
        Some("list") => {
            for b in all()? {
                println!(
                    "{}  {}  {}  {}",
                    b.id,
                    b.name,
                    if b.enabled { "enabled" } else { "manual" },
                    relay_http::relay_url(&b.api)?
                        .origin()
                        .ascii_serialization()
                );
            }
            Ok(())
        }
        Some("messages") => {
            let b = load(args.get(1).ok_or("Choose a binding ID.")?)?;
            let page: Value =
                relay_http::json(call(&b, reqwest::Method::GET, "/messages?limit=5", None).await?)
                    .await?;
            println!(
                "{}",
                serde_json::to_string_pretty(&page).map_err(|_| "Invalid page")?
            );
            Ok(())
        }
        Some("post") => {
            use tokio::io::AsyncReadExt;
            let b = load(args.get(1).ok_or("Choose a binding ID.")?)?;
            let thread = args.get(2).ok_or("Choose the reply thread ID.")?;
            Uuid::parse_str(thread).map_err(|_| "Invalid thread ID.")?;
            let mut body = String::new();
            tokio::io::stdin()
                .take(32_001)
                .read_to_string(&mut body)
                .await
                .map_err(|_| "Cannot read reply stdin.")?;
            validate_reply(&b, &body)?;
            let _: Value = relay_http::json(
                call(
                    &b,
                    reqwest::Method::POST,
                    "/messages",
                    Some(
                        json!({"body":body,"threadRootId":thread,"idempotencyKey":Uuid::new_v4()}),
                    ),
                )
                .await?,
            )
            .await?;
            println!("Reply sent.");
            Ok(())
        }
        Some("adapter") => {
            let id = args.get(1).ok_or("Choose a binding ID.")?;
            path(id)?;
            let _lock = host_storage::lock(&format!("agent-{id}"))?;
            let mut b = load(args.get(1).ok_or("Choose a binding ID.")?)?;
            let a: Adapter = serde_json::from_slice(
                &std::fs::read(args.get(2).ok_or("Choose a local adapter JSON file.")?)
                    .map_err(|_| "Cannot read adapter configuration.")?,
            )
            .map_err(|_| "Invalid adapter configuration.")?;
            agent_adapter::validate(&a)?;
            b.adapter = Some(a);
            store(&b)?;
            println!(
                "Adapter saved. Use `chief-machine agent enable {}` when ready.",
                b.id
            );
            Ok(())
        }
        Some("enable" | "disable") => {
            let id = args.get(1).ok_or("Choose a binding ID.")?;
            path(id)?;
            let _lock = host_storage::lock(&format!("agent-{id}"))?;
            let mut b = load(args.get(1).ok_or("Choose a binding ID.")?)?;
            b.enabled = args[0] == "enable";
            b.failures = 0;
            if !b.enabled {
                b.pending = None;
            }
            if b.enabled && b.adapter.is_none() {
                return Err("Configure an adapter before enabling automatic replies.".into());
            }
            store(&b)?;
            println!(
                "Binding {}.",
                if b.enabled { "enabled" } else { "disabled" }
            );
            Ok(())
        }
        Some("leave") => {
            let b = load(args.get(1).ok_or("Choose a binding ID.")?)?;
            let result = call(&b, reqwest::Method::DELETE, "", None).await?;
            if !result.status().is_success()
                && result.status().as_u16() != 401
                && result.status().as_u16() != 403
            {
                return Err(
                    "Relay did not confirm revocation; saved credentials were retained.".into(),
                );
            }
            std::fs::remove_file(path(&b.id)?).map_err(|_| "Cannot remove saved membership.")?;
            println!("Membership removed.");
            Ok(())
        }
        _ => {
            println!("{HELP}");
            Ok(())
        }
    }
}

fn option(args: &[String], key: &str) -> Option<String> {
    args.iter()
        .position(|v| v == key)
        .and_then(|i| args.get(i + 1))
        .cloned()
}
async fn join(args: &[String]) -> Result<(), String> {
    let raw = args.first().ok_or("Supply the channel invitation URL.")?;
    let mut invite = relay_http::relay_url(raw)?;
    let parts: Vec<_> = invite.path().trim_end_matches('/').split('/').collect();
    if parts.len() != 4
        || parts[1] != "agents"
        || parts[3].len() != 32
        || !parts[3]
            .bytes()
            .all(|v| v.is_ascii_alphanumeric() || v == b'_' || v == b'-')
        || invite.query().is_some()
    {
        return Err(
            "Use the original channel agent invitation URL, without /join or query parameters."
                .into(),
        );
    }
    let name = option(args, "--name").ok_or("Supply --name for your channel identity.")?;
    let provider = option(args, "--provider").unwrap_or("other".into());
    let model = option(args, "--model");
    invite.set_path(&format!("{}/join", invite.path().trim_end_matches('/')));
    let mut body = json!({"name":name,"provider":provider});
    if let Some(model) = model {
        body["model"] = json!(model);
    }
    let joined: Joined = relay_http::json(
        relay_http::client()?
            .post(invite.clone())
            .json(&body)
            .send()
            .await
            .map_err(|_| "Cannot reach the invited relay.")?,
    )
    .await?;
    let api = relay_http::same_origin(&invite, &joined.api.base)?;
    if !api.path().starts_with("/v1/workspaces/")
        || !api.path().ends_with("/guest")
        || api.query().is_some()
        || joined.token.len() < 43
        || joined.token.len() > 512
    {
        return Err("Relay returned an invalid channel enrollment.".into());
    }
    let mut binding = Binding {
        id: Uuid::new_v5(
            &Uuid::NAMESPACE_URL,
            format!("{}:{}", api, joined.guest.id).as_bytes(),
        )
        .to_string(),
        name: joined.guest.name,
        api: api.to_string(),
        token: joined.token,
        cursor: 0,
        enabled: false,
        allow_agent_mentions: false,
        failures: 0,
        adapter: None,
        pending: None,
    };
    store(&binding)?;
    let page: Page =
        relay_http::json(call(&binding, reqwest::Method::GET, "/messages?limit=1", None).await?)
            .await?;
    binding.cursor = page.cursor;
    store(&binding)?;
    println!("Joined as {}. Binding: {}\nChannel access only; machine role is unchanged. Configure an adapter or use messages/post.",binding.name,binding.id);
    Ok(())
}

async fn call(
    b: &Binding,
    method: reqwest::Method,
    suffix: &str,
    body: Option<Value>,
) -> Result<reqwest::Response, String> {
    let base = relay_http::relay_url(&b.api)?;
    let target = relay_http::same_origin(&base, &format!("{}{suffix}", b.api))?;
    let mut request = relay_http::client()?
        .request(method, target)
        .bearer_auth(&b.token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    request
        .send()
        .await
        .map_err(|_| "Channel relay request failed.".into())
}

fn validate_reply(b: &Binding, body: &str) -> Result<(), String> {
    if body.trim().is_empty() || body.chars().count() > 8000 || body.contains(&b.token) {
        return Err("Reply is empty, too long, or contains a host credential.".into());
    }
    if let Ok(machine) = crate::machine::load() {
        if body.contains(&machine.key) {
            return Err("Reply contains a machine credential.".into());
        }
    }
    Ok(())
}

pub async fn serve_host() -> Result<(), String> {
    let _lock = host_storage::lock("serve")?;
    let bindings = all()?;
    let machine = crate::machine::load().is_ok();
    if !machine && bindings.is_empty() {
        return Err("No roles configured. Pair a machine or join a channel first.".into());
    }
    let mut tasks = tokio::task::JoinSet::new();
    if machine {
        tasks.spawn(async { crate::machine::serve().await });
    }
    for b in bindings {
        tasks.spawn(async move { serve_binding(b.id).await });
    }
    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => { tasks.abort_all(); while tasks.join_next().await.is_some() {} return Ok(()); }
            result = tasks.join_next() => match result {
                Some(Ok(Err(error))) => eprintln!("Host role stopped: {error}"),
                Some(Err(_)) => eprintln!("Host role stopped unexpectedly."),
                Some(Ok(Ok(()))) => {},
                None => return Ok(()),
            }
        }
    }
}

async fn serve_binding(id: String) -> Result<(), String> {
    let mut backoff = 2;
    loop {
        let mut b = match load(&id) {
            Ok(b) => b,
            Err(_) => return Ok(()),
        };
        if !b.enabled {
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        }
        match poll(&mut b).await {
            Ok(()) => backoff = 2,
            Err(error) => {
                eprintln!("Agent {id}: {error}");
                backoff = (backoff * 2).min(60);
            }
        }
        tokio::time::sleep(Duration::from_secs(backoff)).await;
    }
}

async fn poll(b: &mut Binding) -> Result<(), String> {
    // A persisted pending reply is retried with the same idempotency key, never rerun.
    if b.pending.is_some() {
        return post_pending(b).await;
    }
    let response = call(
        b,
        reqwest::Method::GET,
        &format!("/messages?after={}&limit=5", b.cursor),
        None,
    )
    .await?;
    if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
        b.enabled = false;
        progress(b)?;
        return Err("Membership revoked or access lost; binding disabled.".into());
    }
    let page: Page = relay_http::json(response).await?;
    let context: Vec<Value>=page.messages.iter().rev().take(5).map(|m|json!({"author":m.author.name,"body":m.body.chars().take(2000).collect::<String>()})).collect();
    for message in page.messages {
        if !load(&b.id)?.enabled {
            return Ok(());
        }
        if message.cursor <= b.cursor {
            continue;
        }
        let wake = message
            .wake_reason
            .as_deref()
            .is_some_and(|v| ["mention", "thread", "all"].contains(&v));
        if !wake
            || message.author.you
            || (message.author.kind != "person" && !b.allow_agent_mentions)
        {
            b.cursor = message.cursor;
            progress(b)?;
            continue;
        }
        let request_id = Uuid::new_v5(
            &Uuid::NAMESPACE_URL,
            format!("{}:{}", b.id, message.id).as_bytes(),
        )
        .to_string();
        let input = TurnInput {
            protocol_version: 1,
            request_id: request_id.clone(),
            message: json!({"author":message.author.name,"body":message.body.chars().take(4000).collect::<String>(),"reason":message.wake_reason}),
            context: context.clone(),
        };
        let adapter = b.adapter.as_ref().ok_or("No adapter configured.")?;
        let body = tokio::select! {
            result=agent_adapter::run(adapter,&input)=>match result {
                Ok(body)=>{b.failures=0;body},
                Err(error)=>{b.failures=b.failures.saturating_add(1);if b.failures>=3 {b.enabled=false;}progress(b)?;return Err(error);}
            },
            _=wait_disabled(&b.id)=>return Ok(()),
        };
        validate_reply(b, &body)?;
        // Re-read the local opt-in after long-running work, before persisting output.
        if !load(&b.id)?.enabled {
            return Ok(());
        }
        b.pending = Some(PendingReply {
            request_id,
            thread_root_id: message.thread_root_id.unwrap_or(message.id),
            body,
            cursor: message.cursor,
        });
        progress(b)?;
        post_pending(b).await?;
    }
    b.cursor = b.cursor.max(page.cursor);
    progress(b)
}

async fn wait_disabled(id: &str) {
    loop {
        tokio::time::sleep(Duration::from_secs(1)).await;
        if !load(id).is_ok_and(|b| b.enabled) {
            return;
        }
    }
}

async fn post_pending(b: &mut Binding) -> Result<(), String> {
    let pending = b.pending.as_ref().ok_or("Missing pending reply.")?;
    if !load(&b.id)?.enabled {
        return Ok(());
    }
    validate_reply(b, &pending.body)?;
    let response=call(b,reqwest::Method::POST,"/messages",Some(json!({"body":pending.body,"threadRootId":pending.thread_root_id,"idempotencyKey":pending.request_id}))).await?;
    if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
        b.enabled = false;
        b.pending = None;
        progress(b)?;
        return Err("Reply refused after revocation; binding disabled.".into());
    }
    let _: Value = relay_http::json(response).await?;
    b.cursor = pending.cursor;
    b.pending = None;
    progress(b)?;
    println!("Agent {} replied.", b.id);
    Ok(())
}

#[cfg(test)]
mod state_tests {
    use super::*;
    #[test]
    fn concurrent_disable_cannot_be_overwritten_by_progress() {
        let root = PathBuf::from(format!("/tmp/chief-agent-state-test-{}", Uuid::new_v4()));
        let previous = std::env::var_os("XDG_CONFIG_HOME");
        std::env::set_var("XDG_CONFIG_HOME", &root);
        let mut stale = Binding {
            id: Uuid::new_v4().to_string(),
            name: "test".into(),
            api: "https://relay.example/v1/workspaces/test/guest".into(),
            token: "fake".into(),
            cursor: 0,
            enabled: true,
            allow_agent_mentions: false,
            failures: 0,
            adapter: None,
            pending: None,
        };
        store(&stale).unwrap();
        let mut current = load(&stale.id).unwrap();
        current.enabled = false;
        store(&current).unwrap();
        stale.cursor = 42;
        progress(&mut stale).unwrap();
        let saved = load(&stale.id).unwrap();
        assert!(!saved.enabled);
        assert_eq!(saved.cursor, 42);
        let _ = std::fs::remove_dir_all(root);
        if let Some(previous) = previous {
            std::env::set_var("XDG_CONFIG_HOME", previous);
        } else {
            std::env::remove_var("XDG_CONFIG_HOME");
        }
    }
}
