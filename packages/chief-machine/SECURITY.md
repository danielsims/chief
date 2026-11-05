# Chief host security review and threat model

## Source study

Reviewed pinned upstream implementations, rather than assuming their architecture was a security guarantee:

- [T3 Code](https://github.com/pingdotgg/t3code/tree/32ecd71726fee16f335484c1f95cbce126d461f6): `ServerBrowserContexts.ts`, `ServerBrowser.ts`, desktop `BrowserSession.ts`, `RpcAuthorization.ts`, peer forwarding and remote authentication. Useful patterns: explicit browser ownership, isolated automation contexts, retained Chrome sandbox, revocable peer credentials and narrowing forwarded capabilities. T3 intentionally permits some reads across agents within the same thread; Chief does not treat that as a suitable cross-workspace boundary.
- [Buzz](https://github.com/block/buzz/tree/1eb67bb525d66448b56d79f98c4ba0e2188b44c5): remote agents, ACP transport/provider launchers, backend/authentication and practical information-flow document. The latter is a **draft proposal**, not evidence of implemented isolation. ACP is an integration seam, not an OS sandbox.
- [agent-browser 0.32.3](https://github.com/vercel-labs/agent-browser/tree/81c336c1c20b80ac648e0416a7b6e0c0ae7878bb): researched as a possible driver, then **removed from this implementation**. Its daemon starts an ancillary localhost HTTP/stream service; some metadata HTTP routes allow wildcard CORS. A runtime test confirmed that behavior and confirmed `stream_disable` closes the listener. Browser protections affect web-page exploitability, but direct CDP avoids this unnecessary surface entirely. Chief now sends a fixed allowlist of CDP methods over a host-owned socket and never exposes caller-selected methods or scripts.
- [Chrome proxy documentation](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md): implicit loopback bypass requires explicit `<-loopback>` subtraction. No `direct://` fallback is configured.

## Assets and trust boundaries

Assets are channel credentials, machine credentials, provider keys, personal browser state, workspace data and the host's local network/files. Channel authors and web pages are untrusted. Relay runtime dispatch is authenticated internal traffic. Local executable selection and adapter configuration require the machine operator's trust.

Channel membership and machine capacity are separate enrollments. Both default to least exposure: joined channel agents are manual until enabled; machines serve their owner's agents unless explicitly broadened. Channel credentials retain existing per-channel relay revocation and membership checks. Provider keys remain on the adapter's machine.

The host does not pass Chief credentials or destination authority to subprocess adapters. It accepts a strict versioned reply, then publishes under its own bound channel identity and thread. Fresh processes avoid accidental in-memory carryover; they do not prevent deliberate filesystem persistence. The local adapter can still read same-UID files. Local CDP also trusts processes on the host, so a separate OS user alone is insufficient for browser confidentiality. Use a container/VM with a separate network namespace for untrusted adapters, and do not place host state or personal browser data inside that boundary. Windows automatic adapters/browser hosting are disabled pending equivalent process-tree cleanup.

Browser sessions are job/agent-bound, pinned to one enrolled machine and never attach to a personal/global CDP browser. Each session owns a new Chrome profile and Chrome process. Session lookup before open, cross-agent access and arbitrary remote execution fields are rejected. Disconnect, close, disable and idle cleanup destroy owned resources; timed-out operations discard the session.

The proxy resolves a destination once, rejects any non-public answer and connects to that validated address. It applies to redirects and subresources as well as top-level navigation. Only HTTP(S) ports 80/443 are allowed. Chrome's loopback proxy bypass, QUIC and non-proxied WebRTC UDP are disabled. IPv4 private/link-local/metadata, IPv6 local, mapped private IPv4 and transition ranges are rejected. Environment-configured proxies are disabled for direct public fetches. **These controls are not OS egress isolation against browser compromise.** For adversarial multi-tenant hosting, enforce public-only egress and filesystem separation at the container/network boundary too.

Relay replies are correlated to the exact originating socket. Another enrolled machine cannot fulfill a request by presenting its ID. Agent membership, native-runtime status and browser permission are checked before dispatch. Machine policy and rate limits apply; unknown sessions and offline pinned machines fail closed. Machine content remains untrusted input to the agent.

## Regression coverage

- Relay tests: unknown/non-agent identities, strict protocol fields, wrong-machine replies, session initialization and offline affinity.
- Rust tests: credential-origin pinning, hostile adapter environment names/output/destination fields, deadlines, progress racing with disable, private and transitional addresses, and live proxy loopback rejection.
- Opt-in real Chrome test: owned Google navigation, cross-agent denial, local fetch/image/frame/WebSocket canary, close cleanup and refusal to read after close.

Tests do not establish resistance to a browser zero-day, privileged local adversary, supply-chain compromise or every DNS/routing configuration. TLS origin pinning does not protect an already compromised legitimate relay. Dependency releases and shipped binaries still require release provenance review. There is no assertion that every Grok/Muse/Dots runtime is integrated: each can use the CLI or implement the same adapter contract.

The real Google test reached a verification page ("Why did this happen?"). This proves browser transport, not successful search results or CAPTCHA avoidance.

## Before a public security bounty

Independently audit enrollment/revocation, workspace authorization and guest credentials end to end; test process crashes/reboots and slow/disconnected peers under load; enforce OS network/filesystem boundaries for untrusted tenants; verify signed release artifacts and dependency provenance; and add platform-specific Windows cleanup before enabling those roles. Live browser takeover and unattended verification handling remain outside this version.
