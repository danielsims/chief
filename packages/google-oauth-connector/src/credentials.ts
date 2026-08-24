import type { GoogleOAuthClientIdentity } from "./types.js";
import {
  GOOGLE_OAUTH_AUTHORIZATION_URL,
  GOOGLE_OAUTH_TOKEN_URL,
} from "./recipes.js";
import { GoogleOAuthSetupError } from "./types.js";

export interface GoogleDesktopOAuthClientValues {
  readonly clientId: unknown;
  readonly clientSecret: unknown;
  readonly projectId?: unknown;
}

type CredentialValue =
  boolean | CredentialRecord | CredentialValue[] | null | number | string;

interface CredentialRecord {
  readonly [key: string]: CredentialValue;
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

function parseCredentialString(value: unknown): string | undefined {
  const text = String(value);
  return text === value && text.trim() ? text.trim() : undefined;
}

function isCredentialRecord(value: unknown): value is CredentialRecord {
  return Object(value) === value && !Array.isArray(value);
}

const parseRequiredCredentialString = (
  value: unknown,
  field: string,
): string => {
  const text = parseCredentialString(value);
  if (!text) {
    throw new GoogleOAuthSetupError(
      "invalid-credentials",
      `Google's credential file is missing ${field}.`,
      "Create a Desktop app OAuth client and download its JSON file again.",
    );
  }
  return text;
};

const parseGoogleEndpoint = (
  value: unknown,
  canonical: string,
  allowed: readonly string[],
  field: string,
): string => {
  if (value === undefined) return canonical;
  const endpoint = parseRequiredCredentialString(value, field);
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
  const clientId = parseRequiredCredentialString(values.clientId, "client_id");
  if (!clientId.endsWith(".apps.googleusercontent.com")) {
    throw new GoogleOAuthSetupError(
      "invalid-credentials",
      "Google returned an invalid Desktop client ID.",
      "Create the OAuth client with Desktop app as its application type.",
    );
  }
  const projectId = parseCredentialString(values.projectId);
  return {
    grant: "authorization_code",
    authorizationUrl: GOOGLE_OAUTH_AUTHORIZATION_URL,
    tokenUrl: GOOGLE_OAUTH_TOKEN_URL,
    clientId,
    clientSecret: parseRequiredCredentialString(
      values.clientSecret,
      "client_secret",
    ),
    ...(projectId ? { projectId } : undefined),
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
  if (!isCredentialRecord(parsed) || !("installed" in parsed)) {
    throw new GoogleOAuthSetupError(
      "invalid-credentials",
      "Google's credential file is not for a Desktop app.",
      "Create the OAuth client with Desktop app as its application type.",
    );
  }
  const installed = parsed.installed;
  if (!isCredentialRecord(installed)) {
    throw new GoogleOAuthSetupError(
      "invalid-credentials",
      "Google's credential file has an invalid Desktop app section.",
      "Download the OAuth client JSON again.",
    );
  }
  const identity = createGoogleDesktopOAuthIdentity({
    clientId: installed.client_id,
    clientSecret: installed.client_secret,
    projectId: installed.project_id,
  });
  return {
    ...identity,
    authorizationUrl: parseGoogleEndpoint(
      installed.auth_uri,
      GOOGLE_OAUTH_AUTHORIZATION_URL,
      GOOGLE_AUTHORIZATION_ENDPOINTS,
      "auth_uri",
    ),
    tokenUrl: parseGoogleEndpoint(
      installed.token_uri,
      GOOGLE_OAUTH_TOKEN_URL,
      GOOGLE_TOKEN_ENDPOINTS,
      "token_uri",
    ),
  };
}
