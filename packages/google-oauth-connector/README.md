# `@chief/google-oauth-connector`

Most people should experience a Google integration as **Sign in with Google**.
They should not need to understand Cloud projects, API libraries, OAuth client
types, publishing status, or one-time secret downloads.

That simple experience should not require the software vendor to own one global
Google credential. A user-owned OAuth client keeps the Cloud project,
credentials, revocation, quotas, and audit trail under the user's control. It
also lets independently distributed desktop software support Google APIs
without making one vendor credential the security and compliance boundary for
every installation.

Google Cloud Console is unusually confusing for non-technical users. This
package gives an agent the recipe and safe credential boundary needed to make
the experience feel like ordinary Sign in with Google while preserving
user-owned credentials.

## One job

This package is a lightweight, framework-neutral toolkit for an **agent-driven**
Google Cloud setup flow. It supplies:

- recipes for the APIs an integration needs;
- canonical Google Console URLs;
- an ordered progress plan for the host UI; and
- strict validation of Google Desktop OAuth client credentials.

It deliberately does not scrape Google Cloud Console or run a background click
script. The same agent that talks to the user controls the host browser through
its ordinary browser tools. Once the human finishes Google authentication, the
host wakes that agent and hands browser control back to it. The agent inspects
the current page, clicks, types, navigates, and recovers in exactly the same way
it would with Codex Browser, Playwright, Browser Use, Browserbase, or another
browser tool provider.

The intended flow is:

```text
Host opens Google's account chooser
  → human signs into the correct Google account
  → host observes the completed navigation and wakes the same agent
  → agent uses normal browser tools to complete the recipe
  → host captures the client from Google's trusted client summary
  → host stores the OAuth client through its existing credential boundary
  → existing OAuth runtime performs normal Google consent
```

The package does **not** authenticate the user into the host app, host an API
server, choose a database, store credentials or refresh tokens, call Google
APIs, or dictate a browser/agent framework.

## Identity and project safety

Remembered Google sessions are a convenience, not authority. The human always
chooses the account for a setup attempt. After Google returns to Cloud Console,
the host records that browser-local `authuser` index, pins it onto every later
Google Cloud and OAuth navigation, and checks it again before every semantic
browser action. If the identity drifts, the host restores the selected account
before the agent can mutate anything.

Likewise, Google's post-login project, current selector and remembered default
are untrusted. The agent must use the sole visible project or collect an
explicit structured project choice, then preserve that exact project ID on
every Console URL. Account and project selection are separate locks.

## Recipes

```ts
import {
  googleAccountChooserUrl,
  googleAnalyticsRecipe,
  googleApiLibraryUrl,
  googleOAuthSetupPlan,
} from "@chief/google-oauth-connector";

const firstApi = googleApiLibraryUrl(googleAnalyticsRecipe.services[0]);
const signInUrl = googleAccountChooserUrl(firstApi);
const progress = googleOAuthSetupPlan(googleAnalyticsRecipe);
```

Google Analytics enables both `analyticsdata.googleapis.com` and
`analyticsadmin.googleapis.com`. Gmail enables `gmail.googleapis.com`. Add
another integration by declaring data, not another automation engine:

```ts
const driveRecipe = {
  id: "google-drive",
  name: "Google Drive",
  services: [{ name: "Google Drive API", service: "drive.googleapis.com" }],
} satisfies GoogleOAuthSetupRecipe;
```

Client naming is agent guidance, not recipe logic. Instruct the setup agent to
create a new client named `<app> - <integration>` and never reuse a client
across services. Separate clients keep scopes, rotation, revocation, and
incident response isolated without turning the recipe schema into a naming
engine.

OAuth scopes intentionally do not live in recipes. Enabling a Cloud API and
asking a human for access are different operations; scopes belong to the
consuming integration's OAuth runtime.

## Secure credential capture

Google's **Download JSON** action is not reliable in every streamed or headless
browser. The host boundary therefore captures the client through Google's
trusted client UI. The agent leaves the client-created dialog open; the host
reads only the client identity, opens that exact client's summary and creates a
fresh secret when Google has already masked the original one-time value. The
host validates and stores that secret without returning either credential to
the agent.

Hosts that already receive Google's Desktop OAuth JSON can still pass it to the
parser:

```ts
import { parseGoogleDesktopOAuthCredentials } from "@chief/google-oauth-connector";

const identity = parseGoogleDesktopOAuthCredentials(downloadContents);
await hostCredentialStore.put(identity);
```

The validated identity includes the client secret. Never log it, return it to the agent,
place it in conversation history or telemetry, or store it as ordinary app
data. The host owns storage; this package does not choose a vault, database,
keychain, server, or environment-variable implementation.

## Chief and Executor

Chief exposes its browser as ordinary local Executor tools: open,
snapshot, click, and fill. Navigation completion is fed back into the Chief
runtime so an authentication handoff resumes the same Setup agent
automatically. The agent completes the Google Console recipe, while a dedicated
host tool captures the client without revealing its ID or secret.

Those host operations belong to the Google OAuth boundary, not to a consuming
service: `googleOAuth.provisionClient` and `googleOAuth.captureClient`. The
agent calls `captureClient` from the client-created dialog or exact client edit
page; the host validates and routes the client without exposing its ID or
secret. The active setup attempt tells the host where to store it. Google Analytics, Gmail,
Drive, and future Google integrations can therefore share credential creation
while keeping their own scopes, authorization, verification, and credential
storage adapters.

Executor remains Chief's OAuth runtime. It owns integration scopes, Google's
normal consent flow, grant storage, token refresh, and authorized API access.
This package does not create a competing OAuth or token-storage path.

Because the boundary is ordinary agent browser tools plus host credential
capture, Codex, Claude Code, OpenCode, Eve, or another harness can consume the
same package without a paid browser service or a proprietary computer-use
plugin.
