# @chief/browser

A reusable pair-browsing primitive for applications where a human and an AI
agent need to operate the same visible browser session.

The browser is deliberately a light bulb, not the intelligence. Chief, Codex,
Claude Code, Executor, a remote agent, or the human can provide the electricity.
This package only keeps them attached to one real browser.

## Why this package is small

[`agent-browser`](https://agent-browser.dev) already provides the hard parts:
the native Rust daemon, Chrome DevTools Protocol control, named and restorable
sessions, accessibility snapshots and refs, downloads, and a bidirectional
WebSocket stream. This package does not reimplement any of them.

It adds two host-facing pieces:

- `@chief/browser/node` — a typed session client around the official CLI.
- `@chief/browser/react` — a visible viewport that renders stream frames and
  forwards human mouse, wheel, and keyboard input to that same session.

Neither side owns exclusive control. An agent can click through the CLI while
the human watches; the human can immediately take over in the viewport; the
agent can continue from the resulting page state.

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

Chief opts into this profile copy only for a user-initiated integration setup
run. That makes existing provider sessions available in the shared browser
without silently authenticating unrelated agent browsing.
Set `CHIEF_BROWSER_PROFILE` to a Chrome profile name/directory to override the
selection, or to `none` to keep Google setup fully isolated.

Chief deliberately does not load copied-profile extensions in its embedded
browser. Password-manager native messaging, biometric prompts, and passkeys
can depend on a foreground browser registered with macOS; trying to make that
work by spawning a second headed Chrome creates two competing browser surfaces.
The human can still use an existing provider session, or select the provider's
password or other sign-in method in the embedded viewport. Chief never reads,
fills, or places those authentication values in agent context.

## React viewport

```tsx
import { AgentBrowserViewport } from "@chief/browser/react";

<AgentBrowserViewport
  streamUrl={streamUrl}
  className="h-full w-full bg-black"
  onViewportResize={(width, height) => resizeBrowser(width, height)}
/>;
```

`@chief/browser/surface` exports `BrowserSurface`, the transport-neutral visual
primitive. It accepts any stream renderer as `children`, plus host-owned
`overlay` and loading content.
Chief composes its operating glow and control pill there; those visuals do not
know about agent-browser, WebSockets, Google, or any agent runtime.

The viewport also accepts an optional `{ type: "cursor", cursor: "pointer" }`
stream message for providers that expose remote cursor semantics. The current
agent-browser JPEG stream does not publish DOM cursor metadata, so Chief does
not fake it with continuous page inspection or force an inaccurate cursor.

The viewport reconnects a dropped WebSocket with bounded backoff while keeping
the last frame visible. Mouse presses are balanced on pointer cancellation,
lost capture, app blur, visibility changes and stream reconnection so the
remote browser cannot remain stuck in a button-down state.

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
