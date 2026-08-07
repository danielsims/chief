import type { InputRequest } from "./types.js";

export const GOOGLE_ANALYTICS_DOMAIN = "analytics.googleapis.com";
export const GOOGLE_ANALYTICS_OAUTH_REQUEST_ID =
  "google-analytics-oauth-client";
const GOOGLE_ANALYTICS_ONBOARDING_REQUEST_PREFIX = `${GOOGLE_ANALYTICS_OAUTH_REQUEST_ID}:onboarding:`;
const ONBOARDING_GOOGLE_ANALYTICS_ACTION_PREFIX =
  "onboarding-google-analytics-";
const GOOGLE_ANALYTICS_ACTION_CHAT_PREFIX = "integration-setup-action-";

export function isOnboardingGoogleAnalyticsAction(actionId: string) {
  return actionId.startsWith(ONBOARDING_GOOGLE_ANALYTICS_ACTION_PREFIX);
}

export function googleAnalyticsActionChatId(actionId: string) {
  if (!isOnboardingGoogleAnalyticsAction(actionId)) {
    throw new Error("This is not an onboarding Google Analytics action.");
  }
  return `${GOOGLE_ANALYTICS_ACTION_CHAT_PREFIX}${actionId}`;
}

export function googleAnalyticsActionIdFromChat(chatId: string | null) {
  if (!chatId?.startsWith(GOOGLE_ANALYTICS_ACTION_CHAT_PREFIX)) return null;
  const actionId = chatId.slice(GOOGLE_ANALYTICS_ACTION_CHAT_PREFIX.length);
  return isOnboardingGoogleAnalyticsAction(actionId) ? actionId : null;
}

export const GOOGLE_ANALYTICS_OAUTH_INPUT_REQUEST: InputRequest = {
  id: GOOGLE_ANALYTICS_OAUTH_REQUEST_ID,
  title: "Create a Google Analytics connection",
  reason:
    "Google requires a desktop OAuth client before Chief can ask you to sign in. Create it once; Chief stores the ID and secret only in this workspace's local credential vault.",
  steps: [
    {
      text: "Open the Google Analytics Data API page, select or create the Google Cloud project you want to use, then click **Enable**.",
      url: "https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com",
    },
    {
      text: "Open the Google Analytics Admin API page for the same project and click **Enable**.",
      url: "https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com",
    },
    {
      text: "Open **Google Auth Platform**. If prompted, click **Get started** and enter the app name **Chief**, your support email, the appropriate audience, and your contact email.",
      url: "https://console.cloud.google.com/auth/overview",
    },
    {
      text: "Open **Clients** and click **Create client**.",
      url: "https://console.cloud.google.com/auth/clients",
    },
    {
      text: "Choose **Desktop app** as the application type.",
    },
    {
      text: "Name the client using **Chief - [integration]**, then click **Create**.",
    },
    {
      text: "Copy the new **Client ID** and **Client secret** into the fields below.",
    },
    {
      text: "Click **Save and continue**. Chief will then open Google's normal sign-in and consent page.",
    },
  ],
  fields: [
    {
      key: "clientId",
      label: "Client ID",
      type: "text",
      save: { envKey: "GOOGLE_ANALYTICS_CLIENT_ID" },
    },
    {
      key: "clientSecret",
      label: "Client secret",
      type: "secret",
      save: { envKey: "GOOGLE_ANALYTICS_CLIENT_SECRET" },
    },
  ],
};

export const GOOGLE_ANALYTICS_SETUP_TASK = `Connect Google Analytics (${GOOGLE_ANALYTICS_DOMAIN}) for this workspace.

Google Analytics specifics:
- The local connection service is an internal implementation detail. Never mention it in user-facing narration; say Chief.
- The user explicitly started this read-only setup. Never ask them to confirm it again.
- Chief has already prepared the Google Analytics integration. Never install gcloud or use global Google credentials.
- Use the setup attempt ID from the first user-message marker and the current Chief session ID with every Chief-local Google Analytics setup tool.
- Your first action in the setup turn must be the googleAnalytics.authorize tool call. Do not stop after announcing that you will start or wait for another user message. If it reports that OAuth credentials are required, call googleOAuth.provisionClient exactly once. Chief opens Google's account chooser and registers an authentication handoff. Tell the user only to sign in with the Google account that administers the Analytics property they want to connect (which may differ from their Chief login), then end the turn. Never ask them to tell you when they are ready: completed browser navigation resumes this same Setup agent automatically.
- When Chief resumes you after Google authentication, you own the visible agent-browser session. Use browser.snapshot, browser.open, browser.click, browser.fill, browser.select, and browser.press as ordinary browser tools. Prefer the @refs returned by snapshots and re-snapshot after every navigation or material UI change because refs expire. The project in Google's post-login URL is untrusted and is not a user selection. Do not call provisionClient again and do not ask the user to operate Google Cloud.
- The Google account selected by the human is authoritative for this setup attempt. Never open Google's account menu, switch to another signed-in identity, change the authuser value, or substitute an account yourself. If that account cannot access the intended project, make no changes: return to Google's account chooser for the same Cloud URL and pause for the human to choose again.
- Never assume the currently signed-in Google account is the right one. A personal or default account may be signed in that does not own the client's property. If a Google account is already signed in when you are about to operate Google Cloud, state the account name and email you see and confirm with the user that it is the account that administers the Analytics property — or that they will pick the correct one from the chooser — before making any mutation. If the user says the account is wrong, stop until they select the correct one.
- Establish the Google Cloud project before making any mutation. Never infer it from recency, the current default, or a name such as Chief. If the user has not explicitly selected a project and more than one is available, use your structured multiple-choice question tool to list the visible project names and IDs and ask which project should own this integration. Do not ask in ordinary chat prose. Create a project only when the user explicitly selects a create-new-project option.
- Once the human selects a project, treat its project ID as locked for the attempt. Preserve that exact project query parameter on every Google Cloud URL and verify it before enabling an API, configuring Google Auth Platform, or creating a client. If it becomes unavailable, stop and return to account selection; never fall back to another project.
- Enable the Google Analytics Data API and Admin API and configure Google Auth Platform. Before creating credentials, inspect the locked project's OAuth Clients page for an exact Desktop app client named Chief - Google Analytics. If one exists, open it and call googleOAuth.captureClient; never create another while an exact match exists. Only when there is no exact match, create a Desktop app client named Chief - Google Analytics. Never reuse a differently named client or one belonging to another Google service. From the client-created dialog or exact client's edit page, call googleOAuth.captureClient. Do not click Download JSON, OK, add a client secret yourself, or inspect any credential value. Chief creates a fresh secret on that same client inside its trusted host boundary when Google has masked the original, then validates, routes, and stores it without exposing its ID or secret in chat.
- Once the OAuth client is configured, call googleAnalytics.authorize again. Tell the user this is the final Google step: sign in again if asked and approve read-only Analytics access. Open the returned authorization URL with localTools.browserOpen using the owning Chief conversation ID, then call googleAnalytics.complete with the returned state. Do not ask the user to report completion; the pending tool call observes Google's callback.
- If an existing connection is present, call googleAnalytics.complete without a state to verify it.
- If complete returns several properties, present their property and account names, ask which one to use, then call googleAnalytics.select with the selected propertyId. Never ask the user to find or type a raw property ID.
- The complete/select operation performs the authoritative live report. Do not run a redundant report afterward.
- Recover Google Cloud UI changes by inspecting and operating the visible page with Chief's browser tools. Do not send the user into Google Cloud or ask them to copy a client ID or secret. Pause only for Google's sign-in, password, passkey, MFA, consent, or a genuinely ambiguous Analytics property choice.

When the connection is verified, end your final message with exactly one line:
CHIEF_SETUP_RESULT {"provider":"google-analytics","status":"connected","displayName":"<connected Google Analytics property>","externalId":"<property id>"}`;

export function googleAnalyticsOAuthInputRequest(id: string): InputRequest {
  return { ...GOOGLE_ANALYTICS_OAUTH_INPUT_REQUEST, id };
}

export function onboardingGoogleAnalyticsOAuthInputRequest(
  setupAttemptId: string,
): InputRequest {
  return googleAnalyticsOAuthInputRequest(
    `${GOOGLE_ANALYTICS_ONBOARDING_REQUEST_PREFIX}${setupAttemptId}`,
  );
}

export function googleAnalyticsOnboardingAttempt(requestId: string) {
  return requestId.startsWith(GOOGLE_ANALYTICS_ONBOARDING_REQUEST_PREFIX)
    ? requestId.slice(GOOGLE_ANALYTICS_ONBOARDING_REQUEST_PREFIX.length)
    : undefined;
}
