# @chief/browser

Typed Node.js control of `agent-browser` sessions used by Chief runtimes.
Browser presentation, stream protocol handling, and human input belong to
`@browser-ui/react`.

## Why this package is small

[`agent-browser`](https://agent-browser.dev) already provides the hard parts:
the native Rust daemon, Chrome DevTools Protocol control, named and restorable
sessions, accessibility snapshots and refs, downloads, and a bidirectional
WebSocket stream. This package does not reimplement any of them.

It adds one host-facing piece: `@chief/browser/node`, a typed session client
around the official CLI. The UI can observe and operate the same named session
through `@browser-ui/react` without making this package depend on React.

## Node host

```ts
import { AgentBrowserSession } from "@chief/browser/node";

const browser = new AgentBrowserSession({
  sessionId: "workspace-analytics-setup",
  downloadPath: "/absolute/private/download-directory",
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});

const stream = await browser.open("https://accounts.google.com/AccountChooser");
// Send stream.url to the local UI. Give the agent the normal agent-browser CLI
// or MCP tools for this same named session.
```

The client also passes through the official `profile`, `cdp`, and
`autoConnect` modes when a host deliberately wants to attach to or clone an
existing Chrome session. `lastUsedChromeProfile()` resolves only Chrome's last
active profile directory; agent-browser then copies that profile into a
temporary directory so the original is never modified.

Integration setup runs are **isolated by default**: Chief does not load a real
Chrome profile, so the setup browser never surfaces the user's personal
signed-in sessions and cannot pick the wrong account. The agent authenticates
once per setup, Chief stores the credentials in the workspace vault, and later
runs use those credentials rather than a persisted browser session.

Set `CHIEF_BROWSER_PROFILE` to a Chrome profile name/directory to deliberately
attach a real profile — for example an account an agent should drive on a
schedule (a social account, an ad account) without re-authenticating or being
given a password. Set it to `none` to force isolation even when an environment
sets the variable globally.

Chief deliberately does not load copied-profile extensions in its embedded
browser. Password-manager native messaging, biometric prompts, and passkeys
can depend on a foreground browser registered with macOS; trying to make that
work by spawning a second headed Chrome creates two competing browser surfaces.
The human can still use an existing provider session, or select the provider's
password or other sign-in method in the embedded viewport. Chief never reads,
fills, or places those authentication values in agent context.

## Authentication handoff

For sign-in, the agent opens the provider page and pauses. The human completes
only password, MFA, account choice, or consent in the same viewport. If the
provider initially offers a passkey or biometric extension flow that cannot
run inside the embedded browser, the agent keeps the same account and asks the
human to choose the provider's password or other sign-in method instead.
The host waits for the expected post-authentication URL and resumes the same
agent with the same browser session. There is no second browser, DOM scraper,
or scripted click runner competing for control.

Persisted browser state can contain session tokens. Keep it local, encrypt it
where the host requires persistence, never place it in chat context, and use
`agent-browser` domain allowlists/content boundaries for untrusted browsing.
Persistence is off by default in this wrapper; opt into `restore: true` only
after configuring the official `AGENT_BROWSER_ENCRYPTION_KEY` protection.
