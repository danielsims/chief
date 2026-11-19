//! Chrome's only web egress: resolve, validate and connect the same public IP.
//! This catches redirects/subresources too, without trusting page scripts or DNS twice.
//! It listens on a Unix socket in the session's private directory, which the
//! session host bridges into Chrome's own network.
use std::{
    net::IpAddr,
    path::Path,
};
use tokio::task::JoinHandle;
#[cfg(unix)]
use std::time::{Duration, Instant};
#[cfg(unix)]
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpStream, UnixListener, UnixStream},
};
use url::Url;

pub struct Proxy {
    task: JoinHandle<()>,
}
impl Drop for Proxy {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[cfg(unix)]
pub async fn start(socket: &Path) -> Result<Proxy, String> {
    let listener = UnixListener::bind(socket).map_err(|_| "Cannot open the browser egress proxy.")?;
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600))
            .map_err(|_| "Cannot protect the browser egress proxy.")?;
    }
    let task = tokio::spawn(async move {
        let limit = std::sync::Arc::new(tokio::sync::Semaphore::new(32));
        let mut tasks = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                accepted=listener.accept()=> {
                    let Ok((mut stream,_))=accepted else {break};
                    let Ok(permit)=limit.clone().try_acquire_owned() else {continue};
                    tasks.spawn(async move {
                        let _permit=permit;
                        if forward(&mut stream).await.is_err() {
                            let _=stream.shutdown().await;
                        }
                    });
                }
                _=tasks.join_next(), if !tasks.is_empty()=>{}
            }
        }
    });
    Ok(Proxy { task })
}

#[cfg(not(unix))]
pub async fn start(_socket: &Path) -> Result<Proxy, String> {
    Err("Browser hosting needs Linux for now.".into())
}

pub fn destination(raw: &str) -> Result<(String, u16), String> {
    let url = Url::parse(raw).map_err(|_| "Invalid browser destination.")?;
    if !["http", "https"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only public web destinations are allowed.".into());
    }
    let port = url.port_or_known_default().ok_or("Missing web port.")?;
    if port != 80 && port != 443 {
        return Err("Browser egress is limited to HTTP/HTTPS ports 80 and 443.".into());
    }
    let host = url
        .host_str()
        .ok_or("Missing web host.")?
        .trim_matches(['[', ']'])
        .trim_end_matches('.')
        .to_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return Err("Local browser destinations are refused.".into());
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if !crate::public_fetch::is_public(ip) {
            return Err("Non-public browser destination refused.".into());
        }
    }
    Ok((host, port))
}

#[cfg(unix)]
async fn public_connect(host: &str, port: u16) -> Result<TcpStream, String> {
    let addresses: Vec<_> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| "Cannot resolve browser destination.")?
        .collect();
    if addresses.is_empty()
        || addresses
            .iter()
            .any(|a| !crate::public_fetch::is_public(a.ip()))
    {
        return Err("Browser DNS resolved a non-public address.".into());
    }
    for address in addresses {
        if let Ok(Ok(stream)) =
            tokio::time::timeout(Duration::from_secs(10), TcpStream::connect(address)).await
        {
            return Ok(stream);
        }
    }
    Err("Cannot reach public browser destination.".into())
}

/// How long a request has to arrive, and a plain HTTP exchange to finish.
#[cfg(unix)]
const REQUEST_TIME: Duration = Duration::from_secs(90);
/// An HTTPS tunnel stays open while anything moves through it, as a video's
/// stream does, and closes after this long with nothing either way.
#[cfg(unix)]
const TUNNEL_IDLE: Duration = Duration::from_secs(120);

#[cfg(unix)]
async fn forward(client: &mut UnixStream) -> Result<(), String> {
    let mut header = Vec::new();
    tokio::time::timeout(REQUEST_TIME, async {
        loop {
            let byte = client
                .read_u8()
                .await
                .map_err(|_| "Proxy connection ended.")?;
            header.push(byte);
            if header.ends_with(b"\r\n\r\n") {
                return Ok(());
            }
            if header.len() > 16_384 {
                return Err("Proxy header too large.");
            }
        }
    })
    .await
    .map_err(|_| "Proxy request timed out.")??;
    let text = std::str::from_utf8(&header).map_err(|_| "Invalid proxy header.")?;
    let mut parts = text
        .lines()
        .next()
        .ok_or("Missing proxy request.")?
        .split_whitespace();
    let method = parts.next().ok_or("Missing proxy method.")?;
    let target = parts.next().ok_or("Missing proxy target.")?;
    let raw = if method == "CONNECT" {
        format!("https://{target}/")
    } else {
        target.to_string()
    };
    let result = async {
        let (host, port) = destination(&raw)?;
        let mut remote = public_connect(&host, port).await?;
        if method == "CONNECT" {
            client
                .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                .await
                .map_err(|_| "Proxy disconnected.")?;
        } else {
            if !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].contains(&method) {
                return Err("Proxy method refused.".into());
            }
            let url = Url::parse(target).map_err(|_| "Invalid web request.")?;
            let path = match url.query() {
                Some(query) => format!("{}?{query}", url.path()),
                None => url.path().to_string(),
            };
            let mut outgoing = format!("{method} {path} HTTP/1.1\r\n");
            let mut body_length = 0u64;
            for line in text.lines().skip(1).filter(|line| !line.is_empty()) {
                let key = line.split(':').next().unwrap_or("").to_ascii_lowercase();
                let value = line.split_once(':').map_or("", |(_, v)| v.trim());
                if key == "transfer-encoding" {
                    return Err("Chunked proxy uploads are refused.".into());
                }
                if key == "content-length" {
                    body_length = value.parse().map_err(|_| "Invalid content length.")?;
                }
                if ![
                    "proxy-authorization",
                    "proxy-connection",
                    "connection",
                    "host",
                ]
                .contains(&key.as_str())
                {
                    outgoing.push_str(line);
                    outgoing.push_str("\r\n");
                }
            }
            outgoing.push_str(&format!(
                "Host: {}\r\nConnection: close\r\n\r\n",
                url.authority()
            ));
            remote
                .write_all(outgoing.as_bytes())
                .await
                .map_err(|_| "Public request failed.")?;
            // One request per connection: later pipelined requests could name
            // another host, so nothing past this body is forwarded.
            let (read_client, mut write_client) = client.split();
            let (read_remote, mut write_remote) = remote.split();
            return tokio::time::timeout(REQUEST_TIME, async {
                tokio::io::copy(
                    &mut read_client.take(body_length.min(8 * 1024 * 1024)),
                    &mut write_remote,
                )
                .await
                .map_err(|_| "Public request failed.")?;
                tokio::io::copy(&mut read_remote.take(8 * 1024 * 1024), &mut write_client)
                    .await
                    .map_err(|_| "Browser proxy stream ended.")?;
                write_client
                    .shutdown()
                    .await
                    .map_err(|_| "Browser proxy stream ended.".into())
            })
            .await
            .map_err(|_| "Public request timed out.".to_string())?;
        }
        tunnel(client, &mut remote)
            .await
            .map_err(|_| "Browser proxy stream ended.".into())
    }
    .await;
    if result.is_err() {
        let _ = client
            .write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await;
    }
    result
}

/// Copies both ways until both sides finish or nothing has moved for
/// `TUNNEL_IDLE`.
#[cfg(unix)]
async fn tunnel(client: &mut UnixStream, remote: &mut TcpStream) -> std::io::Result<()> {
    use std::sync::atomic::AtomicU64;
    let opened = Instant::now();
    let moved = AtomicU64::new(0);
    let (mut read_client, mut write_client) = client.split();
    let (mut read_remote, mut write_remote) = remote.split();
    let idle = async {
        loop {
            tokio::time::sleep(Duration::from_secs(15)).await;
            let quiet = opened.elapsed().as_secs() - moved.load(std::sync::atomic::Ordering::Relaxed);
            if quiet >= TUNNEL_IDLE.as_secs() {
                return;
            }
        }
    };
    tokio::select! {
        result = async {
            tokio::try_join!(
                pump(&mut read_client, &mut write_remote, opened, &moved),
                pump(&mut read_remote, &mut write_client, opened, &moved),
            )
        } => result.map(|_| ()),
        _ = idle => Ok(()),
    }
}

/// One direction of a tunnel, noting when bytes last moved.
#[cfg(unix)]
async fn pump<R, W>(
    reader: &mut R,
    writer: &mut W,
    opened: Instant,
    moved: &std::sync::atomic::AtomicU64,
) -> std::io::Result<()>
where
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin,
{
    let mut buffer = vec![0u8; 16 * 1024];
    loop {
        let n = reader.read(&mut buffer).await?;
        if n == 0 {
            return writer.shutdown().await;
        }
        writer.write_all(&buffer[..n]).await?;
        moved.store(opened.elapsed().as_secs(), std::sync::atomic::Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_local_transition_and_metadata_destinations() {
        for raw in [
            "http://localhost",
            "http://127.1",
            "http://0.0.0.0",
            "http://10.0.0.1",
            "http://169.254.169.254",
            "http://100.100.100.200",
            "http://[::1]",
            "http://[::ffff:127.0.0.1]",
            "http://[64:ff9b::7f00:1]",
            "http://[2002:7f00:1::]",
            "http://192.0.0.1",
            "file:///etc/passwd",
            "https://user:secret@example.com",
            "https://example.com:9222",
        ] {
            assert!(destination(raw).is_err(), "{raw}");
        }
        assert!(destination("https://example.com/search?q=chief").is_ok());
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn proxy_does_not_connect_to_loopback() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("proxy.sock");
        let _proxy = start(&path).await.unwrap();
        let mut socket = UnixStream::connect(&path).await.unwrap();
        socket
            .write_all(b"CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .await
            .unwrap();
        let mut response = [0; 512];
        let n = socket.read(&mut response).await.unwrap();
        assert!(std::str::from_utf8(&response[..n])
            .unwrap()
            .contains("403 Forbidden"));
    }
}
