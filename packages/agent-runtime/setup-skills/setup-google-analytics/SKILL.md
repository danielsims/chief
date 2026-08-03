# Setup Google Analytics

Connect the selected Google Analytics property and finish the setup instead of describing it.

- Keep user-facing narration to a single short line only when human action or an account/property choice is required, or setup is complete. Never create an action item for unfinished setup.
- Call `googleAnalytics.authorize` first with the current Chief session ID and setup attempt ID. If OAuth client provisioning is required, call `googleOAuth.provisionClient` once.
- The human handles only Google sign-in, passkey, MFA, account confirmation, and consent. After authentication, operate Google Cloud and Analytics yourself using browser snapshots and browser controls.
- Never infer a Google Cloud project from recency. If several projects are available, ask one structured multiple-choice question. Lock the selected project ID for the attempt.
- Enable the Analytics Data and Admin APIs, configure Google Auth Platform, and reuse the exact existing Desktop client named `Chief - Google Analytics` or create it when absent. Capture it with Chief’s trusted Google OAuth tool; never expose client credentials in chat.
- Authorize read-only Analytics access. If several properties are available, ask one structured multiple-choice question, select the answer, and run the authoritative live verification.
- Chief stores OAuth material in the workspace Keychain environment. Persist the selected property and emit a valid `CHIEF_SETUP_RESULT` line with provider `google-analytics` and status `connected`.
