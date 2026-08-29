import { describe, expect, it } from "vitest";

import { parseJsonObject } from "@chief/relay-contracts";

import { routeRelayAuth } from "../src/auth/routes";
import { relayTestEnv } from "./helpers";

describe("relay-local authentication", () => {
  const relayEnv = relayTestEnv();

  it("publishes OAuth 2.1 metadata for the relay issuer", async () => {
    const response = await routeRelayAuth(
      new Request(
        "https://relay.test/.well-known/oauth-authorization-server/api/auth",
      ),
      relayEnv,
    );
    expect(response.status).toBe(200);
    const metadata = parseJsonObject(await response.json());
    if (!metadata) throw new Error("OAuth metadata must be a JSON object.");
    expect(metadata).toMatchObject({
      issuer: "https://relay.test/api/auth",
      authorization_endpoint: "https://relay.test/api/auth/oauth2/authorize",
      token_endpoint: "https://relay.test/api/auth/oauth2/token",
    });
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
  }, 15_000);

  it("allows credentialed auth requests only from exact trusted origins", async () => {
    const allowed = await routeRelayAuth(
      new Request("https://relay.test/api/auth/get-session", {
        method: "OPTIONS",
        headers: { origin: "https://app.test" },
      }),
      relayEnv,
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://app.test",
    );
    expect(allowed.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
    expect(allowed.headers.get("access-control-allow-methods")).toContain(
      "PATCH",
    );

    const denied = await routeRelayAuth(
      new Request("https://relay.test/api/auth/get-session", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example" },
      }),
      relayEnv,
    );
    expect(denied.status).toBe(403);
  });

  it("starts a standard native PKCE flow with the registered desktop client", async () => {
    const authorize = new URL("https://relay.test/api/auth/oauth2/authorize");
    authorize.search = new URLSearchParams({
      client_id: "chief-desktop",
      redirect_uri: "chief-desktop:///auth",
      response_type: "code",
      scope: "openid profile email offline_access",
      state: "pkce-state",
      code_challenge: "A".repeat(43),
      code_challenge_method: "S256",
      resource: "https://relay.test",
    }).toString();
    const response = await routeRelayAuth(
      new Request(authorize, { redirect: "manual" }),
      relayEnv,
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://app.test");
    // A device with no browser session must sign in first.
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("client_id")).toBe("chief-desktop");
    expect(location.searchParams.get("state")).toBe("pkce-state");
    expect(location.searchParams.get("sig")).toBeTruthy();
  });
});
