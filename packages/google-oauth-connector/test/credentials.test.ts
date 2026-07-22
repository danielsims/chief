import assert from "node:assert/strict";
import test from "node:test";

import {
  createGoogleDesktopOAuthIdentity,
  GOOGLE_OAUTH_AUTHORIZATION_URL,
  GoogleOAuthSetupError,
  parseGoogleDesktopOAuthCredentials,
  redactGoogleOAuthCredentials,
} from "../src/index.js";

void test("validates a securely captured Google Desktop client", () => {
  const result = createGoogleDesktopOAuthIdentity({
    clientId: "client.apps.googleusercontent.com",
    clientSecret: "secret",
    projectId: "example-project",
  });

  assert.equal(result.clientId, "client.apps.googleusercontent.com");
  assert.equal(result.clientSecret, "secret");
  assert.equal(result.projectId, "example-project");
});

void test("parses a Google Desktop OAuth credential download", () => {
  const result = parseGoogleDesktopOAuthCredentials(
    JSON.stringify({
      installed: {
        client_id: "client.apps.googleusercontent.com",
        project_id: "example-project",
        auth_uri: GOOGLE_OAUTH_AUTHORIZATION_URL,
        token_uri: "https://oauth2.googleapis.com/token",
        client_secret: "secret",
        redirect_uris: ["http://localhost"],
      },
    }),
  );

  assert.equal(result.clientId, "client.apps.googleusercontent.com");
  assert.equal(result.clientSecret, "secret");
  assert.equal(result.projectId, "example-project");
  assert.equal(result.grant, "authorization_code");
});

void test("rejects Web credentials", () => {
  assert.throws(
    () =>
      parseGoogleDesktopOAuthCredentials(
        JSON.stringify({
          web: {
            client_id: "web.apps.googleusercontent.com",
            client_secret: "secret",
          },
        }),
      ),
    (error) => error instanceof GoogleOAuthSetupError,
  );
});

void test("never accepts a Desktop credential without a secret", () => {
  assert.throws(
    () =>
      parseGoogleDesktopOAuthCredentials(
        JSON.stringify({
          installed: { client_id: "client.apps.googleusercontent.com" },
        }),
      ),
    /client_secret/,
  );
});

void test("normalizes Google's documented legacy JSON endpoints", () => {
  const result = parseGoogleDesktopOAuthCredentials(
    JSON.stringify({
      installed: {
        client_id: "client.apps.googleusercontent.com",
        client_secret: "secret",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://accounts.google.com/o/oauth2/token",
      },
    }),
  );

  assert.equal(result.authorizationUrl, GOOGLE_OAUTH_AUTHORIZATION_URL);
  assert.equal(result.tokenUrl, "https://oauth2.googleapis.com/token");
});

void test("rejects credential files that redirect OAuth to another host", () => {
  assert.throws(
    () =>
      parseGoogleDesktopOAuthCredentials(
        JSON.stringify({
          installed: {
            client_id: "client.apps.googleusercontent.com",
            client_secret: "secret",
            auth_uri: "https://example.com/authorize",
          },
        }),
      ),
    /unexpected auth_uri/,
  );
});

void test("redacts Google OAuth material before it enters agent context", () => {
  const visible = redactGoogleOAuthCredentials(
    '- button "Copy to clipboard: GOCSPX-private-secret" [ref=e3]\n' +
      "https://console.cloud.google.com/auth/clients/123-client.apps.googleusercontent.com",
  );

  assert.doesNotMatch(visible, /GOCSPX-private-secret/);
  assert.doesNotMatch(visible, /123-client\.apps\.googleusercontent\.com/);
  assert.match(visible, /\[ref=e3\]/);
  assert.match(visible, /credential protected/);
  assert.match(visible, /client ID protected/);
});
