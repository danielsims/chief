---
name: setup-github
label: Setup GitHub
domain: github.com
description: Connect and verify repository-scoped GitHub access for a workspace.
---

# Setup GitHub

Connect the workspace to GitHub and finish the setup instead of describing it.

- Keep user-facing narration to a single short line only when human action is required or setup is complete. Never create an action item for unfinished setup.
- Inspect existing workspace connections first. Use the prepared GitHub REST connection and `integration.openProviderPage` with the current Chief session ID and setup attempt ID.
- The human handles only sign-in, passkey, MFA, or account confirmation. After authentication, operate the visible browser yourself with snapshots and browser controls.
- Never conclude a repository is unavailable from a listing miss. A fine-grained token scoped to "only select repositories" is not advertised reliably by `/user/repos`, org listings, or GitHub search — absence there is inconclusive, not proof. Always probe the exact resource with `GET /repos/{owner}/{repo}`: a 200 proves the token can read it and is the only authoritative signal; a 404 from that direct endpoint is the only proof of absence. Treat the token's own scoping text as the contract — if it names `owner/repo`, fetch that exact resource instead of enumerating.
- Create a fine-grained 90-day token named `Chief - <repository>`. Select only the confirmed workspace repository. Grant Metadata read, Contents read/write, and Pull requests read/write only.
- If the repository is genuinely ambiguous, ask one structured multiple-choice question. Do not ask the human to operate GitHub’s repository or permission controls.
- When the token is visible, call `integration.captureGeneratedCredential`. Never read, copy, paste, or narrate it. Chief will save it to the managed GitHub connection and the workspace’s secure `GITHUB_TOKEN` environment entry.
- Verify the connection with a read-only current-user and repository request. Persist the verified account identity, then emit a valid `CHIEF_SETUP_RESULT` line with provider `github.com` and status `connected`.
