# chief-machine

One host with two independently enabled roles:

- A channel agent: join an invited channel, read messages and reply as an external agent.
- A workspace machine: offer public-page fetching and, optionally, an isolated Chrome browser.

Joining a channel does **not** enroll or share the machine. Pairing a machine does **not** grant channel membership. Existing agents can use the CLI directly; automatic replies use a provider-neutral subprocess adapter.

## Build and test this change

This source change is not released yet. Build it from the Chief checkout:

```sh
cd packages/chief-machine
cargo build --locked --features cli
./target/debug/chief-machine --help
cargo test --locked --features cli
```

The installed release binary will not contain these changes until released. The release packaging script builds the same package with a locked dependency graph.

## Connect an existing agent

Create a channel agent invitation in Chief, then run:

```sh
chief-machine agent join <invite-url> --name MyAgent --provider other
chief-machine agent list
chief-machine agent messages <binding-id>
printf '%s' 'Hello from my existing agent' | chief-machine agent post <binding-id> <thread-id>
```

`messages` returns five recent messages. Joining records the current cursor, so enabling an adapter does not replay old mentions. Invitations and credentials are secrets: do not paste them into public logs. The channel credential is stored in private host state, never printed by `list`.

For automatic replies, create a local JSON adapter configuration:

```json
{
  "command": ["/absolute/path/to/your-adapter"],
  "cwd": "/absolute/path/to/agent-workspace",
  "environment": ["OPENAI_API_KEY"],
  "timeoutSeconds": 300
}
```

Then:

```sh
chief-machine agent adapter <binding-id> /absolute/path/to/adapter.json
chief-machine agent enable <binding-id>
chief-machine serve
```

The executable receives one JSON object on stdin:

```json
{
  "protocolVersion": 1,
  "requestId": "opaque-id",
  "message": {
    "author": "Member",
    "body": "Untrusted channel text",
    "reason": "mention"
  },
  "context": []
}
```

It must exit successfully and write **only** this JSON shape to stdout:

```json
{ "protocolVersion": 1, "requestId": "same-opaque-id", "body": "Reply text" }
```

Provider launchers, SDK integrations or ACP clients fit behind this contract. No provider-specific agent support is claimed or required by the host. See `examples/echo-adapter.py` for a protocol smoke test, not an intelligent agent.

The host chooses identity, channel and reply thread; adapter output cannot redirect delivery. Chief credentials are omitted from stdin and the inherited environment. Execution uses argv without a shell, an explicit environment allowlist, bounded input/output, a deadline, a fresh process per message and Unix process-group cancellation. Automatic replies handle human mentions and followed threads; agent-origin messages are ignored to avoid bot loops. After three adapter failures the binding disables itself. Pending replies retry with the same durable idempotency key.

```sh
chief-machine agent disable <binding-id>
chief-machine agent leave <binding-id>
```

Restart `serve` after adding a new binding. Enable/disable and existing adapter configuration changes are picked up without restarting. Automatic adapters currently require macOS/Linux; Windows needs a Job Object implementation before that role can be enabled.

## Offer a machine

In Chief, use Settings → Machines → Add a machine:

```sh
chief-machine pair <one-time-token> --name 'Workspace browser'
chief-machine allow mine
chief-machine serve
```

`mine` is the default. `allow workspace` is an explicit broader grant. Remove the machine in Chief to revoke its relay credential and disconnect it. The host makes an outbound connection; it does not expose a public control port. Local pairing/policy removal is detected by a healthy connection within 30 seconds.

For interactive browsing, install Google Chrome, then opt in:

```sh
chief-machine browser enable \
  --chrome '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --headed
chief-machine browser status
chief-machine serve
```

Linux uses its absolute Chrome executable. No separate driver is required. Browser hosting currently requires Unix. The host talks directly to its owned Chrome through a private CDP connection. This package does not silently download executables or attach to your existing Chrome. Four isolated sessions may run at once. Each has its own empty profile, an owned Chrome process and public-only HTTP proxy. Chrome sandboxing stays enabled. Sessions expire after 15 minutes of inactivity and are destroyed on disconnect; browsing state cannot migrate to another machine. Native relay agents also require workspace membership and `browser.use` permission.

Google search is ordinary browser navigation. A site can still require verification or refuse automated browsing. Live browser streaming/human takeover is not implemented in this new host; snapshots, interaction and screenshots are supported. Do not enable it for workloads requiring signed-in personal profiles.

```sh
chief-machine browser disable
```

The host cancels active operations when disabled and reaps idle sessions on its next heartbeat. No arbitrary scripts, shell commands, host paths or remote CDP URLs are accepted by the relay browser protocol.

## Security boundary

Read [SECURITY.md](./SECURITY.md) before offering capacity or running third-party adapters. A subprocess running as the same OS user can read that user's files regardless of the JSON protocol. Run untrusted agent software in a separate OS account/container with no Chief host credentials mounted. Browser proxy restrictions are defense in depth, not a substitute for an OS/network sandbox against a compromised browser process. This implementation is ready for controlled local testing, not a claim of independent security certification.

The old `chief-listen` shell-based implementation is retired. Revoke its memberships before replacing it; credentials are not automatically imported.
