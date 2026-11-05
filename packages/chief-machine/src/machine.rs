//! `chief-machine`: lends this machine's internet connection to a Chief
//! workspace's agents. Pair once with the command the app shows, then keep
//! `chief-machine serve` running (under systemd, launchd or a service).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::protocol::{
    Claimed, Config, Discovery, FetchRequest, FetchResult, PairingToken, Policy, PolicyMessage,
    Ticket,
};
use crate::public_fetch;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::{mpsc, Semaphore};
use tokio_tungstenite::tungstenite::Message;

/// Pages fetched at once; the relay also limits how many it sends.
const CONCURRENT_FETCHES: usize = 4;
const PING_EVERY: Duration = Duration::from_secs(30);
const MAX_BACKOFF: Duration = Duration::from_secs(60);

const HELP: &str = "chief-machine — lend this machine's internet connection to your Chief agents

Usage:
  chief-machine pair <token> [--name <name>]  Pair with the command from Settings → Machines
  chief-machine serve                         Lend this machine's connection until stopped
  chief-machine allow mine|workspace          Choose who may use it (default: mine)
  chief-machine status                        Show what this machine is paired with
  chief-machine forget                        Remove this machine's saved key

Agents can only fetch public web pages through it. Remove it from
Settings → Machines in the app to cut it off at once.";

pub async fn run(args: Vec<String>) {
    let result = match args.first().map(String::as_str) {
        Some("pair") => pair(&args[1..]).await,
        Some("serve") => serve().await,
        Some("allow") => allow(args.get(1).map(String::as_str)),
        Some("status") => status(),
        Some("forget") => forget(),
        Some("--version" | "-V") => {
            println!("chief-machine {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        _ => {
            println!("{HELP}");
            Ok(())
        }
    };
    if let Err(message) = result {
        eprintln!("chief-machine: {message}");
        std::process::exit(1);
    }
}

pub fn config_path() -> Result<PathBuf, String> {
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
    };
    Ok(base
        .ok_or("Couldn't find a config directory.")?
        .join("chief-machine")
        .join("config.json"))
}

pub fn load() -> Result<Config, String> {
    crate::host_storage::load(&config_path()?)
}

fn save(config: &Config) -> Result<(), String> {
    crate::host_storage::save(&config_path()?, config)
}

fn machine_name() -> String {
    std::env::var("COMPUTERNAME")
        .ok()
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .or_else(|| std::env::var("HOSTNAME").ok())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Machine".into())
}

fn http() -> Result<reqwest::Client, String> {
    crate::relay_http::client()
}

async fn pair(args: &[String]) -> Result<(), String> {
    let token = args
        .first()
        .ok_or("Paste the token from Settings → Machines → Add a machine.")?;
    let name = args
        .iter()
        .position(|arg| arg == "--name")
        .and_then(|index| args.get(index + 1))
        .cloned()
        .unwrap_or_else(machine_name);
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(token.trim().trim_end_matches('='))
        .map_err(|_| "That token isn't valid. Copy it again from the app.")?;
    let pairing: PairingToken = serde_json::from_slice(&decoded)
        .map_err(|_| "That token isn't valid. Copy it again from the app.")?;
    let relay = crate::relay_http::relay_url(&pairing.relay)?
        .origin()
        .ascii_serialization();
    let response = http()?
        .post(format!(
            "{relay}/v1/workspaces/{}/machines/claim",
            pairing.workspace_id
        ))
        .json(&serde_json::json!({ "code": pairing.code, "name": name }))
        .send()
        .await
        .map_err(|error| format!("Couldn't reach the relay: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Pairing failed ({}). The code works once, for 15 minutes; add the machine again.",
            response.status()
        ));
    }
    let claimed: Claimed = response.json().await.map_err(|error| error.to_string())?;
    save(&Config {
        relay,
        workspace_id: pairing.workspace_id,
        machine_id: claimed.machine_id,
        key: claimed.key,
        policy: Policy::Mine,
    })?;
    println!("Paired as \"{name}\". Run `chief-machine serve` to start lending this machine's connection.");
    println!("Only your agents can use it until you run `chief-machine allow workspace`.");
    Ok(())
}

fn allow(choice: Option<&str>) -> Result<(), String> {
    let mut config = load()?;
    config.policy = match choice {
        Some("mine") => Policy::Mine,
        Some("workspace") => Policy::Workspace,
        _ => return Err("Choose `mine` or `workspace`.".into()),
    };
    save(&config)?;
    println!("Saved. A running `serve` picks this up when it reconnects; restart it to apply now.");
    Ok(())
}

fn status() -> Result<(), String> {
    let config = load()?;
    println!("Relay      {}", config.relay);
    println!("Workspace  {}", config.workspace_id);
    println!("Machine    {}", config.machine_id);
    println!(
        "Used by    {}",
        match config.policy {
            Policy::Mine => "your agents",
            Policy::Workspace => "everyone in the workspace",
        }
    );
    Ok(())
}

fn forget() -> Result<(), String> {
    let path = config_path()?;
    match std::fs::remove_file(&path) {
        Ok(()) => println!("Forgot this machine's key. Remove it in the app too."),
        Err(_) => println!("Nothing to forget."),
    }
    Ok(())
}

enum Ended {
    /// The relay no longer knows this machine; stop rather than retry.
    Removed,
    Dropped(String),
}

pub async fn serve() -> Result<(), String> {
    load()?;
    println!("Lending this machine's connection. Ctrl-C to stop.");
    let mut backoff = Duration::from_secs(1);
    loop {
        let config = load()?;
        let session = tokio::select! {
            ended = connect(&config) => ended,
            _ = tokio::signal::ctrl_c() => return Ok(()),
        };
        match session {
            Ended::Removed => {
                return Err(
                    "This machine was removed from the workspace. Pair it again to lend it.".into(),
                )
            }
            Ended::Dropped(reason) => {
                eprintln!(
                    "{}  disconnected: {reason}; retrying in {}s",
                    now(),
                    backoff.as_secs()
                );
                tokio::select! {
                    _ = tokio::time::sleep(backoff) => {}
                    _ = tokio::signal::ctrl_c() => return Ok(()),
                }
                backoff = (backoff * 2).min(MAX_BACKOFF);
            }
        }
    }
}

/// One connection: fetch a ticket with the machine key, open the socket and
/// answer fetches until it drops.
async fn connect(config: &Config) -> Ended {
    let client = match http() {
        Ok(client) => client,
        Err(error) => return Ended::Dropped(error),
    };
    let discovery: Discovery = match async {
        client
            .get(format!("{}/.well-known/relay", config.relay))
            .send()
            .await?
            .json()
            .await
    }
    .await
    {
        Ok(discovery) => discovery,
        Err(error) => return Ended::Dropped(error.to_string()),
    };
    let response = match client
        .post(format!(
            "{}/v1/workspaces/{}/machines/socket-tickets",
            config.relay, config.workspace_id
        ))
        .bearer_auth(&config.key)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return Ended::Dropped(error.to_string()),
    };
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Ended::Removed;
    }
    let ticket: Ticket = match response.error_for_status() {
        Ok(response) => match response.json().await {
            Ok(ticket) => ticket,
            Err(error) => return Ended::Dropped(error.to_string()),
        },
        Err(error) => return Ended::Dropped(error.to_string()),
    };
    let mut socket_url = match url::Url::parse(&discovery.websocket_url) {
        Ok(url) => url,
        Err(_) => return Ended::Dropped("Invalid relay socket URL".into()),
    };
    let scheme = if socket_url.scheme() == "wss" {
        "https"
    } else if socket_url.scheme() == "ws" {
        "http"
    } else {
        return Ended::Dropped("Invalid relay socket scheme".into());
    };
    if socket_url.set_scheme(scheme).is_err()
        || crate::relay_http::relay_url(&config.relay)
            .and_then(|origin| crate::relay_http::same_origin(&origin, socket_url.as_str()))
            .is_err()
    {
        return Ended::Dropped("Relay attempted to change socket origin".into());
    }
    let mut url = match url::Url::parse(&discovery.websocket_url) {
        Ok(url) => url,
        Err(error) => return Ended::Dropped(error.to_string()),
    };
    url.query_pairs_mut()
        .append_pair("workspaceId", &config.workspace_id)
        .append_pair("ticket", &ticket.ticket)
        .append_pair("role", "web-machine");
    let mut socket_config = tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default();
    socket_config.max_message_size = Some(32_768);
    socket_config.max_frame_size = Some(32_768);
    let (socket, _) = match tokio_tungstenite::connect_async_with_config(
        url.as_str(),
        Some(socket_config),
        false,
    )
    .await
    {
        Ok(connected) => connected,
        Err(error) => return Ended::Dropped(error.to_string()),
    };
    let (mut sink, mut stream) = socket.split();
    let policy = serde_json::to_string(&PolicyMessage {
        policy: config.policy,
    })
    .expect("policy serialises");
    if let Err(error) = sink.send(Message::text(policy)).await {
        return Ended::Dropped(error.to_string());
    }
    println!("{}  connected", now());

    let browsers = Arc::new(tokio::sync::Mutex::new(crate::browser::Sessions::default()));
    let browser_slot = Arc::new(Semaphore::new(1));
    let mut tasks = tokio::task::JoinSet::new();
    let (replies, mut outgoing) = mpsc::channel::<String>(32);
    let fetches = Arc::new(Semaphore::new(CONCURRENT_FETCHES));
    let mut ping = tokio::time::interval(PING_EVERY);
    loop {
        tokio::select! {
            incoming = stream.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    if text.as_str() == "pong" { continue; }
                    if text.len()>32_768 {continue;}
                    let Ok(value)=serde_json::from_str::<serde_json::Value>(text.as_str()) else {continue;};
                    if value.get("type").and_then(|v|v.as_str())==Some("browser.request") {
                        let mut value=value;value.as_object_mut().unwrap().remove("type");
                        let Ok(request)=serde_json::from_value::<crate::browser::Request>(value) else {continue;};
                        let replies=replies.clone();let browsers=browsers.clone();
                        let Ok(permit)=browser_slot.clone().try_acquire_owned() else {
                            let _=replies.try_send(serde_json::json!({"type":"browser.result","requestId":request.request_id,"ok":false,"error":"Browser machine is busy."}).to_string());continue;
                        };
                        tasks.spawn(async move {let _permit=permit;let reply=browsers.lock().await.execute(request).await;let _=replies.send(reply.to_string()).await;});
                    } else if let Ok(request)=serde_json::from_value::<FetchRequest>(value) {
                        let replies=replies.clone();
                        let Ok(permit)=fetches.clone().try_acquire_owned() else {continue;};
                        tasks.spawn(async move {let _permit=permit;let reply=answer(request).await;let _=replies.send(reply).await;});
                    }
                }
                Some(Ok(Message::Close(frame))) => {
                    return Ended::Dropped(frame.map(|frame| frame.reason.to_string()).unwrap_or_else(|| "closed".into()));
                }
                Some(Ok(_)) => {}
                Some(Err(error)) => return Ended::Dropped(error.to_string()),
                None => return Ended::Dropped("closed".into()),
            },
            Some(_) = tasks.join_next(), if !tasks.is_empty() => {},
            Some(reply) = outgoing.recv() => {
                if let Err(error) = sink.send(Message::text(reply)).await {
                    return Ended::Dropped(error.to_string());
                }
            }
            _ = ping.tick() => {
                if let Ok(mut sessions)=browsers.try_lock(){sessions.reap();}
                // Local revocation or policy changes take effect even on a healthy socket.
                if !load().is_ok_and(|current|current.key==config.key && serde_json::to_value(current.policy).ok()==serde_json::to_value(config.policy).ok()) {return Ended::Dropped("Local machine settings changed".into());}
                if let Err(error) = sink.send(Message::text("ping")).await {
                    return Ended::Dropped(error.to_string());
                }
            }
        }
    }
}

/// Fetches one page and logs who asked for which site; never the page itself.
async fn answer(request: FetchRequest) -> String {
    let site = url::Url::parse(&request.url)
        .ok()
        .and_then(|url| {
            url.host_str()
                .map(|host| host.trim_start_matches("www.").to_string())
        })
        .unwrap_or_default();
    let result = match public_fetch::fetch(&request.url).await {
        Ok(page) => {
            log(
                &request,
                &site,
                if page.status < 400 { "ok" } else { "refused" },
            );
            FetchResult {
                request_id: request.request_id,
                ok: true,
                status: Some(page.status),
                url: Some(page.url),
                content_type: Some(page.content_type),
                body: Some(page.body),
                error: None,
            }
        }
        Err(error) => {
            log(&request, &site, "failed");
            FetchResult {
                request_id: request.request_id,
                ok: false,
                status: None,
                url: None,
                content_type: None,
                body: None,
                error: Some(error.chars().take(500).collect()),
            }
        }
    };
    serde_json::to_string(&result).expect("result serialises")
}

fn log(request: &FetchRequest, site: &str, outcome: &str) {
    let on_behalf = request
        .requester_user_id
        .as_deref()
        .map(|user| format!(" for {user}"))
        .unwrap_or_default();
    println!(
        "{}  {}{on_behalf}  {site}  {outcome}",
        now(),
        request.agent_id
    );
}

/// The current UTC time as `YYYY-MM-DD HH:MM:SS`, without a date library.
fn now() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0);
    let (days, rest) = (seconds.div_euclid(86_400), seconds.rem_euclid(86_400));
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02}",
        rest / 3_600,
        rest % 3_600 / 60,
        rest % 60
    )
}
