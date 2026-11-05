//! Enrollment pins the origin. Never follow a credential-bearing redirect.
use serde::de::DeserializeOwned;
use std::time::Duration;
use url::Url;

pub fn relay_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "Invalid relay URL.")?;
    let local = match url.host() {
        Some(url::Host::Domain(host)) => host == "localhost",
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    };
    if !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !(url.scheme() == "https" || (url.scheme() == "http" && local))
    {
        return Err(
            "Use HTTPS for the relay; HTTP is allowed only on loopback for local development."
                .into(),
        );
    }
    Ok(url)
}

pub fn same_origin(base: &Url, raw: &str) -> Result<Url, String> {
    let target = relay_url(raw)?;
    if base.origin() != target.origin() {
        return Err("Relay attempted to change credential origin.".into());
    }
    Ok(target)
}

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("chief-machine/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "Cannot initialize relay transport.".into())
}

pub async fn json<T: DeserializeOwned>(mut response: reqwest::Response) -> Result<T, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Relay refused the request ({status})."));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Relay response interrupted.")?
    {
        if bytes.len() + chunk.len() > 1_048_576 {
            return Err("Relay response exceeds the host limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Relay returned an invalid response.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn origins_fail_closed() {
        for url in [
            "http://example.com",
            "https://u:p@example.com",
            "https://example.com/#secret",
            "file:///etc/passwd",
        ] {
            assert!(relay_url(url).is_err());
        }
        let base = relay_url("https://chief.example").unwrap();
        assert!(same_origin(&base, "https://attacker.example/guest").is_err());
        assert!(same_origin(&base, "https://chief.example:444/guest").is_err());
        assert!(same_origin(&base, "https://chief.example/v1/guest").is_ok());
        assert!(relay_url("http://localhost:8080").is_ok());
    }
}
