//! Fetches public web pages for a workspace's agents from this machine's own
//! connection. Every request is held to the public internet: a host
//! that resolves to a private, loopback or link-local address is refused, on
//! the first request and on every redirect, so an agent can never use this
//! machine to reach the owner's home network or this computer itself.

use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::Arc;
use std::time::Duration;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::{redirect, Url};
use serde::Serialize;

/// Matches the relay's limit for one socket message.
pub const BODY_LIMIT: usize = 700_000;
const MAX_REDIRECTS: usize = 5;
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fetched {
    pub status: u16,
    pub url: String,
    pub content_type: String,
    pub body: String,
}

fn is_public_v4(ip: std::net::Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || ip.is_multicast()
        || a == 0
        || (a == 100 && (64..=127).contains(&b))
        || (a == 198 && (b == 18 || b == 19))
        || a >= 240)
}

fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_v4(v4);
            }
            let first = v6.segments()[0];
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80)
        }
    }
}

/// Only http(s), no credentials, and an IP literal must itself be public.
/// Names are checked when they resolve, by [`PublicOnly`].
fn check_url(url: &Url) -> Result<(), String> {
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err("Only public HTTP or HTTPS pages can be fetched.".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URLs with credentials can't be fetched.".into());
    }
    match url.host() {
        Some(url::Host::Ipv4(ip)) if !is_public(IpAddr::V4(ip)) => {
            Err("Private addresses can't be fetched.".into())
        }
        Some(url::Host::Ipv6(ip)) if !is_public(IpAddr::V6(ip)) => {
            Err("Private addresses can't be fetched.".into())
        }
        Some(url::Host::Domain(host))
            if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") =>
        {
            Err("Local addresses can't be fetched.".into())
        }
        None => Err("The URL has no host.".into()),
        _ => Ok(()),
    }
}

/// Resolves names and refuses any that point at a non-public address, which
/// also stops a public name being re-pointed at the local network.
struct PublicOnly;

impl Resolve for PublicOnly {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_owned();
        Box::pin(async move {
            let addresses: Vec<SocketAddr> =
                tokio::task::spawn_blocking(move || {
                    (host.as_str(), 0).to_socket_addrs().map(|found| found.collect())
                })
                .await
                .map_err(|error| -> Box<dyn std::error::Error + Send + Sync> { error.into() })??;
            if addresses.is_empty() || addresses.iter().any(|address| !is_public(address.ip())) {
                return Err("The host resolves to a private address.".into());
            }
            let addresses: Addrs = Box::new(addresses.into_iter());
            Ok(addresses)
        })
    }
}

/// Fetches one public page, refusing anything that isn't on the public internet.
pub async fn fetch(url: &str) -> Result<Fetched, String> {
    let url = Url::parse(url).map_err(|_| "The URL isn't valid.".to_string())?;
    check_url(&url)?;
    let client = reqwest::Client::builder()
        .dns_resolver(Arc::new(PublicOnly))
        .redirect(redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                attempt.error("The page redirected too many times.")
            } else if let Err(reason) = check_url(attempt.url()) {
                attempt.error(reason)
            } else {
                attempt.follow()
            }
        }))
        .timeout(Duration::from_secs(20))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client
        .get(url)
        .header("accept", "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8")
        .header("accept-language", "en-AU,en;q=0.9")
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .chars()
        .take(200)
        .collect();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        let room = BODY_LIMIT.saturating_sub(bytes.len());
        bytes.extend_from_slice(&chunk[..chunk.len().min(room)]);
        if bytes.len() >= BODY_LIMIT {
            break;
        }
    }
    let mut body = String::from_utf8_lossy(&bytes).into_owned();
    // Cut on a character boundary so the text stays within the limit.
    while body.len() > BODY_LIMIT {
        body.pop();
    }
    Ok(Fetched {
        status,
        url: final_url,
        content_type,
        body,
    })
}
