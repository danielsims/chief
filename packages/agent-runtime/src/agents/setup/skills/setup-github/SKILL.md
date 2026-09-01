---
name: setup-github
label: Setup GitHub
domain: github.com
description: Connect and verify repository-scoped GitHub access for a workspace.
---

# Setup GitHub

Connect the workspace to GitHub and finish the setup instead of describing it.

- Keep user-facing narration to a single short line only when human action is required or setup is complete. Never create an action item for unfinished setup.
- Inspect existing plugins first. Use the bundled `github` plugin rather than browsing GitHub settings or creating a token.
- If Chief presents the GitHub installation flow, wait for the human to finish it. If Chief reports that GitHub authorization is not configured for the relay, report that configuration requirement plainly and stop. Never substitute another credential path.
- The human chooses the GitHub account, organizations, repositories, and permissions in GitHub's own installation UI. Never broaden that selection or ask for a personal access token.
- Treat the authorized repository set as the complete boundary. If a repository is missing, ask the user to update the GitHub connection rather than trying another credential path.
- Never conclude a repository is unavailable from a listing miss. Probe the exact repository with a read-only plugin call before reporting that it is outside the authorized set.
- If the repository is genuinely ambiguous, ask one structured multiple-choice question.
- Verify the connection with a read-only current-user and repository request, then emit a valid `CHIEF_SETUP_RESULT` line with provider `github.com` and status `connected`.
