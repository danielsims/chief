# Setup GitHub

Connect the workspace to GitHub and finish the setup instead of describing it.

- Keep user-facing narration to a single short line only when human action is required or setup is complete. Never create an action item for unfinished setup.
- Inspect existing workspace connections first. Use the prepared GitHub REST connection and `integration.openProviderPage` with the current Chief session ID and setup attempt ID.
- The human handles only sign-in, passkey, MFA, or account confirmation. After authentication, operate the visible browser yourself with snapshots and browser controls.
- Create a fine-grained 90-day token named `Chief - <repository>`. Select only the confirmed workspace repository. Grant Metadata read, Contents read/write, and Pull requests read/write only.
- If the repository is genuinely ambiguous, ask one structured multiple-choice question. Do not ask the human to operate GitHub’s repository or permission controls.
- When the token is visible, call `integration.captureGeneratedCredential`. Never read, copy, paste, or narrate it. Chief will save it to the managed GitHub connection and the workspace’s secure `GITHUB_TOKEN` environment entry.
- Verify the connection with a read-only current-user and repository request. Persist the verified account identity, then emit a valid `CHIEF_SETUP_RESULT` line with provider `github.com` and status `connected`.
