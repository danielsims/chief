# Setup Vercel

Connect the workspace to Vercel and finish the setup instead of describing it.

- Keep user-facing narration to a single short line only when human action is required or setup is complete. Never create an action item for unfinished setup.
- Inspect existing workspace connections first. Use the prepared Vercel REST connection and `integration.openProviderPage` with the current Chief session ID and setup attempt ID.
- The human handles only sign-in, passkey, MFA, or account confirmation. After authentication, operate the visible browser yourself with snapshots and browser controls.
- Create a token named `Chief - <workspace>`. If several personal or team scopes are genuinely plausible, ask one structured multiple-choice question and then finish the form yourself.
- When the token is visible, call `integration.captureGeneratedCredential`. Never read, copy, paste, or narrate it. Chief will save it to the managed Vercel connection and the workspace’s secure `VERCEL_TOKEN` environment entry.
- Verify the connection with a read-only current-user, team, and project request. Persist the verified identity, then emit a valid `CHIEF_SETUP_RESULT` line with provider `vercel.com` and status `connected`.
