use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

pub const OAUTH_LOOPBACK_EVENT: &str = "chief://oauth-loopback";
pub const OAUTH_LOOPBACK_PORT: u16 = 3_000;
pub const OAUTH_LOOPBACK_REDIRECT: &str = "http://localhost:3000/auth/desktop";
const OAUTH_LOOPBACK_PATH: &str = "/auth/desktop";
const OAUTH_LOOPBACK_LEGACY_PATH: &str = "/oauth/callback";

#[derive(Default)]
pub struct OAuthLoopback {
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl OAuthLoopback {
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[tauri::command]
pub fn start_oauth_loopback(app: AppHandle) -> Result<String, String> {
    let state = app.state::<Mutex<OAuthLoopback>>();
    let mut loopback = state
        .lock()
        .map_err(|_| "Chief could not start its browser sign-in listener.".to_string())?;
    loopback.stop();
    loopback.stop = Arc::new(AtomicBool::new(false));
    let stop = Arc::clone(&loopback.stop);
    let listeners = bind_loopback_listeners()?;
    let handle = app.clone();
    loopback.worker = Some(thread::spawn(move || run_loopback(handle, listeners, stop)));
    Ok(OAUTH_LOOPBACK_REDIRECT.to_string())
}

#[tauri::command]
pub fn stop_oauth_loopback(app: AppHandle) -> Result<(), String> {
    let state = app.state::<Mutex<OAuthLoopback>>();
    let mut loopback = state
        .lock()
        .map_err(|_| "Chief could not stop its browser sign-in listener.".to_string())?;
    loopback.stop();
    Ok(())
}

fn bind_loopback_listeners() -> Result<Vec<TcpListener>, String> {
    let mut listeners = Vec::new();
    for host in ["127.0.0.1", "::1"] {
        match TcpListener::bind((host, OAUTH_LOOPBACK_PORT)) {
            Ok(listener) => {
                listener.set_nonblocking(true).map_err(|_| {
                    "Chief could not listen for the browser sign-in callback.".to_string()
                })?;
                listeners.push(listener);
            }
            Err(_) => continue,
        }
    }
    if listeners.is_empty() {
        return Err(
            "Chief could not listen on localhost:3000 for sign-in. Quit anything using that port and try again."
                .to_string(),
        );
    }
    Ok(listeners)
}

fn run_loopback(app: AppHandle, listeners: Vec<TcpListener>, stop: Arc<AtomicBool>) {
    while !stop.load(Ordering::SeqCst) {
        let mut idle = true;
        for listener in &listeners {
            match listener.accept() {
                Ok((stream, peer)) => {
                    idle = false;
                    if peer.ip().is_loopback() {
                        handle_connection(&app, stream);
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => {}
            }
        }
        if idle {
            thread::sleep(Duration::from_millis(50));
        }
    }
}

fn handle_connection(app: &AppHandle, mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let Some(buffer) = read_http_head(&mut stream) else {
        return;
    };
    let Some((method, target)) = request_target(&buffer) else {
        write_response(
            &mut stream,
            "400 Bad Request",
            "text/plain; charset=utf-8",
            "",
        );
        return;
    };
    if method.eq_ignore_ascii_case("OPTIONS") {
        write_response(
            &mut stream,
            "204 No Content",
            "text/plain; charset=utf-8",
            "",
        );
        return;
    }
    if !method.eq_ignore_ascii_case("GET") || !callback_target(target) {
        write_response(
            &mut stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            "",
        );
        return;
    }
    let callback = format!("http://localhost:{OAUTH_LOOPBACK_PORT}{target}");
    let _ = app.emit(OAUTH_LOOPBACK_EVENT, callback);
    write_response(
        &mut stream,
        "200 OK",
        "text/html; charset=utf-8",
        "<!doctype html><title>Chief</title><p>You&rsquo;re in. Chief is signing you in now. You can close this tab.</p>",
    );
}

fn read_http_head(stream: &mut TcpStream) -> Option<String> {
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 512];
    while bytes.len() < 8_192 {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => {
                bytes.extend_from_slice(&chunk[..count]);
                if bytes.windows(4).any(|window| window == b"\r\n\r\n")
                    || bytes.windows(2).any(|window| window == b"\n\n")
                {
                    break;
                }
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.kind() == std::io::ErrorKind::TimedOut =>
            {
                break;
            }
            Err(_) => return None,
        }
    }
    String::from_utf8(bytes).ok()
}

fn request_target(buffer: &str) -> Option<(&str, &str)> {
    let line = buffer.split(['\r', '\n']).find(|value| !value.is_empty())?;
    let mut parts = line.split(' ');
    let method = parts.next()?;
    let target = parts.next()?;
    Some((method, target))
}

fn callback_target(target: &str) -> bool {
    let path = target.split('?').next().unwrap_or(target);
    path == OAUTH_LOOPBACK_PATH || path == OAUTH_LOOPBACK_LEGACY_PATH
}

fn write_response(stream: &mut TcpStream, status: &str, content_type: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Private-Network: true\r\n\
         Access-Control-Allow-Methods: GET, OPTIONS\r\n\
         Access-Control-Allow-Headers: *\r\n\
         Cache-Control: no-store\r\n\
         Connection: close\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         \r\n\
         {body}",
        body.len()
    );
    let _ = stream.flush();
}

#[cfg(test)]
mod tests {
    use super::{callback_target, request_target};

    #[test]
    fn reads_the_registered_desktop_callback() {
        let (method, target) = request_target(
            "GET /auth/desktop?code=abc&state=def HTTP/1.1\r\nHost: localhost:3000\r\n\r\n",
        )
        .expect("request line");
        assert_eq!(method, "GET");
        assert!(callback_target(target));
    }

    #[test]
    fn rejects_other_paths() {
        assert!(!callback_target("/sign-in?code=abc"));
        assert!(!callback_target("/auth/desktop/../secret"));
    }
}
