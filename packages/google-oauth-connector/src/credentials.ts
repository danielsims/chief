import type { GoogleOAuthClientIdentity } from "./types.js";
import {
  GOOGLE_OAUTH_AUTHORIZATION_URL,
  GOOGLE_OAUTH_TOKEN_URL,
} from "./recipes.js";
import { GoogleOAuthSetupError } from "./types.js";

interface GoogleInstalledCredentials {
  readonly client_id?: unknown;
  readonly client_secret?: unknown;
  readonly project_id?: unknown;
  readonly auth_uri?: unknown;
  readonly token_uri?: unknown;
}

export interface GoogleDesktopOAuthClientValues {
  readonly clientId: unknown;
  readonly clientSecret: unknown;
  readonly projectId?: unknown;
}

/** Remove OAuth client material before browser state enters model context. */
export function redactGoogleOAuthCredentials(value: string) {
  return value
    .replace(
      /(Copy to clipboard:)\s*[^"\n]+/gi,
      "$1 [Google OAuth credential protected]",
    )
    .replace(
      /\b\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com\b/g,
      "[Google OAuth client ID protected]",
    )
    .replace(
      /\bGOCSPX-[a-zA-Z0-9_-]+\b/g,
      "[Google OAuth client secret protected]",
    );
}

const GOOGLE_AUTHORIZATION_ENDPOINTS = [
  GOOGLE_OAUTH_AUTHORIZATION_URL,
  "https://accounts.google.com/o/oauth2/auth",
] as const;

const GOOGLE_TOKEN_ENDPOINTS = [
  GOOGLE_OAUTH_TOKEN_URL,
  "https://accounts.google.com/o/oauth2/token",
  "https://www.googleapis.com/oauth2/v3/token",
] as const;

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GoogleOAuthSetupError(
      "invalid-credentials",
      `Google's credential file is missing ${field}.`,
      "Create a Desktop app OAuth client and download its JSON file again.",
    );
  }
  return value.trim();
};

const googleEndpoint = (
  value: unknown,
  canonical: string,
  allowed: readonly string[],
  field: string,
): string => {
  if (value === undefined) return canonical;
  const endpoint = requiredString(value, field);
  if (!allowed.includes(endpoint)) {
    throw new GoogleOAuthSetupError(
      "invalid-credentials",
      `Google's credential file contains an unexpected ${field}.`,
      "Use the JSON downloaded directly from the Google Cloud OAuth client dialog.",
    );
  }
  return canonical;
};

export function createGoogleDesktopOAuthIdentity(
  values: GoogleDesktopOAuthClientValues,
): GoogleOAuthClientIdentity {
  const clientId = requiredString(values.clientId, "client_id");
  if (!clientId.endsWith(".apps.googleusercontent.com")) {
    throw new GoogleOAuthSetupError(
      "invalid-credentials",
      "Google returned an invalid Desktop client ID.",
      "Create the OAuth client with Desktop app as its application type.",
    );
  }
  const projectId =
    typeof values.projectId === "string" && values.projectId.trim()
      ? values.projectId.trim()
      : undefined;
  return {
    grant: "authorization_code",
    authorizationUrl: GOOGLE_OAUTH_AUTHORIZATION_URL,
    tokenUrl: GOOGLE_OAUTH_TOKEN_URL,
    clientId,
    clientSecret: requiredString(values.clientSecret, "client_secret"),
    ...(projectId ? { projectId } : {}),
  };
}

export function parseGoogleDesktopOAuthCredentials(
  contents: string,
): GoogleOAuthClientIdentity {
  if (contents.length > 256 * 1024) {
    throw new GoogleOAuthSetupError(
      "invalid-credentials",
      "Google's credential file is unexpectedly large.",
      "Use the JSON downloaded directly from the Google Cloud OAuth client dialog.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new GoogleOAuthSetupError(
      "invalid-credentials",
      "Google's credential download was not valid JSON.",
      "Download the OAuth client JSON again.",
    );
  }
  if (!parsed || typeof parsed !== "object" || !("installed" in parsed)) {
    throw new GoogleOAuthSetupError(
      "invalid-credentials",
      "Google's credential file is not for a Desktop app.",
      "Create the OAuth client with Desktop app as its application type.",
    );
  }
  const installed = parsed.installed;
  if (!installed || typeof installed !== "object") {
    throw new GoogleOAuthSetupError(
      "invalid-credentials",
      "Google's credential file has an invalid Desktop app section.",
      "Download the OAuth client JSON again.",
    );
  }
  const values: GoogleInstalledCredentials = installed;
  const identity = createGoogleDesktopOAuthIdentity({
    clientId: values.client_id,
    clientSecret: values.client_secret,
    projectId: values.project_id,
  });
  return {
    ...identity,
    authorizationUrl: googleEndpoint(
      values.auth_uri,
      GOOGLE_OAUTH_AUTHORIZATION_URL,
      GOOGLE_AUTHORIZATION_ENDPOINTS,
      "auth_uri",
    ),
    tokenUrl: googleEndpoint(
      values.token_uri,
      GOOGLE_OAUTH_TOKEN_URL,
      GOOGLE_TOKEN_ENDPOINTS,
      "token_uri",
    ),
  };
}
