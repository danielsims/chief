import type { InputRequest } from "./types.js";

export const GOOGLE_ANALYTICS_DOMAIN = "analytics.googleapis.com";
export const GOOGLE_ANALYTICS_OAUTH_REQUEST_ID =
  "google-analytics-oauth-client";
const GOOGLE_ANALYTICS_ONBOARDING_REQUEST_PREFIX = `${GOOGLE_ANALYTICS_OAUTH_REQUEST_ID}:onboarding:`;

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
      text: "Name the client **Chief**, then click **Create**.",
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
