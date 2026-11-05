//! A provider-neutral, keyless subprocess seam. The host owns identity and destination.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Adapter {
    pub command: Vec<String>,
    pub cwd: PathBuf,
    #[serde(default)]
    pub environment: Vec<String>,
    #[serde(default = "deadline")]
    pub timeout_seconds: u64,
}
fn deadline() -> u64 {
    300
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnInput {
    pub protocol_version: u8,
    pub request_id: String,
    pub message: Value,
    pub context: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TurnOutput {
    protocol_version: u8,
    request_id: String,
    body: String,
}

pub fn validate(adapter: &Adapter) -> Result<(), String> {
    if cfg!(windows) {
        return Err("Automatic adapters require Unix process-group cleanup; Windows support needs a Job Object boundary.".into());
    }
    if adapter.command.is_empty()
        || adapter.command.len() > 64
        || !PathBuf::from(&adapter.command[0]).is_absolute()
        || !adapter.cwd.is_absolute()
        || adapter
            .command
            .iter()
            .any(|arg| arg.len() > 4096 || arg.contains('\0'))
        || adapter.timeout_seconds == 0
        || adapter.timeout_seconds > 900
    {
        return Err("Use an absolute executable and working directory, at most 64 arguments, and a deadline from 1 to 900 seconds.".into());
    }
    for key in &adapter.environment {
        if key.is_empty()
            || key.len() > 100
            || !key
                .bytes()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'_')
            || key.starts_with("CHIEF_")
            || key.starts_with("AGENT_BROWSER_")
            || key.starts_with("LD_")
            || key.starts_with("DYLD_")
            || [
                "NODE_OPTIONS",
                "PYTHONPATH",
                "BASH_ENV",
                "ENV",
                "SHELLOPTS",
                "RUST_LOG",
            ]
            .contains(&key.as_str())
        {
            return Err("Invalid or reserved adapter environment name.".into());
        }
    }
    Ok(())
}

// Lives across every await so cancellation also kills the entire process group.
struct ProcessGroup(Option<u32>);
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(pid) = self.0 {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
        }
    }
}
pub async fn run(adapter: &Adapter, input: &TurnInput) -> Result<String, String> {
    validate(adapter)?;
    let encoded = serde_json::to_vec(input).map_err(|_| "Cannot encode adapter turn.")?;
    if encoded.len() > 32_768 {
        return Err("Adapter input is too large.".into());
    }
    let mut command = tokio::process::Command::new(&adapter.command[0]);
    command
        .args(&adapter.command[1..])
        .current_dir(&adapter.cwd)
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .env("LANG", "C.UTF-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    for key in &adapter.environment {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command
        .spawn()
        .map_err(|_| "Cannot start the configured adapter.")?;
    let mut group = ProcessGroup(child.id());
    let result = tokio::time::timeout(Duration::from_secs(adapter.timeout_seconds), async {
        let mut stdin = child.stdin.take().ok_or("Missing adapter input.")?;
        let mut stdout = child
            .stdout
            .take()
            .ok_or("Missing adapter output.")?
            .take(65_537);
        let writer = async move {
            stdin
                .write_all(&encoded)
                .await
                .map_err(|_| "Adapter refused turn input.")?;
            stdin
                .shutdown()
                .await
                .map_err(|_| "Adapter input interrupted.")
        };
        let reader = async {
            let mut bytes = Vec::new();
            stdout
                .read_to_end(&mut bytes)
                .await
                .map_err(|_| "Adapter output interrupted.")?;
            Ok::<_, &str>(bytes)
        };
        let (_, bytes) = tokio::try_join!(writer, reader)?;
        if bytes.len() > 65_536 {
            return Err("Adapter output exceeded 65536 bytes.");
        }
        // Kill surviving descendants while the leader is still unreaped, so
        // this process-group ID cannot have been reused by an unrelated process.
        #[cfg(unix)]
        if let Some(pid) = group.0.take() {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
        }
        let status = child
            .wait()
            .await
            .map_err(|_| "Adapter exited unexpectedly.")?;
        if !status.success() {
            return Err("Adapter returned a failure exit status.");
        }
        Ok(bytes)
    })
    .await;
    // Cleanup descendants on success, failure and timeout; nothing can keep the output pipe alive.
    drop(group);
    let _ = child.kill().await;
    let bytes = result
        .map_err(|_| "Adapter deadline exceeded.")?
        .map_err(String::from)?;
    let output: TurnOutput = serde_json::from_slice(&bytes).map_err(|_| {
        "Adapter must return one protocol v1 JSON object containing requestId and body."
    })?;
    if output.protocol_version != 1
        || output.request_id != input.request_id
        || output.body.trim().is_empty()
        || output.body.chars().count() > 8000
    {
        return Err("Adapter returned an invalid version, request ID or reply length.".into());
    }
    Ok(output.body)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn executable_and_environment_are_local_configuration() {
        let mut config = Adapter {
            command: vec!["sh".into()],
            cwd: PathBuf::from("/tmp"),
            environment: vec![],
            timeout_seconds: 10,
        };
        assert!(validate(&config).is_err());
        config.command[0] = "/bin/echo".into();
        for key in [
            "CHIEF_TOKEN",
            "AGENT_BROWSER_CDP",
            "LD_PRELOAD",
            "NODE_OPTIONS",
            "bad=name",
        ] {
            config.environment = vec![key.into()];
            assert!(validate(&config).is_err());
        }
        config.environment = vec!["OPENAI_API_KEY".into()];
        assert!(validate(&config).is_ok());
    }
}

#[cfg(all(test, unix))]
mod process_tests {
    use super::*;
    fn input() -> TurnInput {
        TurnInput {
            protocol_version: 1,
            request_id: "test-request".into(),
            message: serde_json::json!({"body":"untrusted text"}),
            context: vec![],
        }
    }
    fn adapter(script: &str) -> Adapter {
        Adapter {
            command: vec!["/usr/bin/python3".into(), "-c".into(), script.into()],
            cwd: "/tmp".into(),
            environment: vec![],
            timeout_seconds: 2,
        }
    }
    #[tokio::test]
    async fn strict_reply_and_no_inherited_chief_environment() {
        std::env::set_var(
            "CHIEF_TEST_CREDENTIAL",
            "fake-credential-must-not-reach-child",
        );
        let body=run(&adapter("import json,sys,os; x=json.load(sys.stdin); assert 'CHIEF_TEST_CREDENTIAL' not in os.environ; print(json.dumps({'protocolVersion':1,'requestId':x['requestId'],'body':'safe'}))"),&input()).await.unwrap();
        assert_eq!(body, "safe");
        for script in ["print('{}')","print('x'*65537)","import sys; sys.exit(1)","print('{\"protocolVersion\":1,\"requestId\":\"wrong\",\"body\":\"no\"}')","print('{\"protocolVersion\":1,\"requestId\":\"test-request\",\"body\":\"no\",\"channelId\":\"elsewhere\"}')"]{assert!(run(&adapter(script),&input()).await.is_err());}
    }
    #[tokio::test]
    async fn bounded_deadline() {
        let mut a = adapter("import time; time.sleep(60)");
        a.timeout_seconds = 1;
        let start = std::time::Instant::now();
        assert!(run(&a, &input()).await.is_err());
        assert!(start.elapsed() < Duration::from_secs(3));
    }
}
