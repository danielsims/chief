---
name: setup-gmail
label: Setup Gmail
domain: gmail.googleapis.com
description: Connect and verify read-only Gmail access for a workspace.
---

# Setup Gmail

Connect the selected Gmail account with read-only mailbox access and finish the setup instead of describing it.

- Keep user-facing narration to a single short line only when human action or an account choice is required, or setup is complete. Never create an action item for unfinished setup.
- Gmail is wired through the same generic connect stack as Google Analytics: an OAuth client, an OpenAPI integration, and a connection. It is not a preconfigured domain like Analytics, so drive the generic tools directly. Do not call `googleAnalytics.authorize` — that adapter is Analytics-only.
- The human handles only Google sign-in, passkey, MFA, account confirmation, and the read-only consent screen. After authentication, operate Google Cloud and Gmail yourself using browser snapshots and browser controls.
- Never infer a Google Cloud project from recency. If several projects are available, ask one structured multiple-choice question. Lock the selected project ID for the attempt.
- Reuse the exact existing Desktop OAuth client named `Chief - Gmail` when present, or create it when absent, and capture it with Chief's trusted Google OAuth tool (`googleOAuth.captureClient`). Never expose client credentials in chat. Desktop clients are public PKCE clients: no client secret is involved, so the user only signs in.
- Register the Gmail integration with the Gmail OpenAPI 3 spec scoped to `gmail.readonly` only. Gmail's published spec is in Google Discovery v1 format, which `openapi.addSpec` rejects; register a minimal OpenAPI 3 spec with only the read-only operations, or use the spec format that accepts a Google discovery document if one exists. Never register send/delete operations.
- Create the connection with the registered OAuth client and start the OAuth flow (`oauth.start`), which opens Google's consent screen in Chief's browser. The user signs in and approves read-only mailbox access. If the flow throws a 500, the stale authorization flow is the cause — start a fresh OAuth flow rather than resuming it.
- Once authenticated, verify with an authoritative live read (for example the user's own profile or the first few messages) and emit a valid `CHIEF_SETUP_RESULT` line with provider `gmail` and status `connected`.
