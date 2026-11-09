import { relayOrigin } from "../hosted-project-checkout";
import { HttpError } from "../http";
import { mcpConnectionsFindOAuthRequest } from "../queries/mcp-connections/find-oauth-request";

export const MCP_OAUTH_CALLBACK_PATH = "/mcp/oauth/callback";
export const MCP_OAUTH_CLIENT_METADATA_PATH = "/mcp/oauth/client-metadata.json";
export const MCP_OAUTH_START_PATH = "/mcp/oauth/start";

/**
 * What Chief sends to dynamic client registration. No client_id or
 * client_uri: servers assign the id, and many reject a client_uri on another
 * origin than the one they register.
 */
export function mcpRegistrationMetadata(env: Env) {
  const origin = relayOrigin(env);
  return {
    client_name: "Chief",
    redirect_uris: [`${origin}${MCP_OAUTH_CALLBACK_PATH}`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    // A public client: PKCE protects the code, so there is no secret to leak.
    token_endpoint_auth_method: "none",
  };
}

/**
 * The Client ID Metadata Document served at its own URL. Its client_uri must
 * share the client_id's origin, so it points at the relay.
 */
export function mcpClientMetadata(env: Env) {
  const origin = relayOrigin(env);
  return {
    client_id: `${origin}${MCP_OAUTH_CLIENT_METADATA_PATH}`,
    client_uri: origin,
    ...mcpRegistrationMetadata(env),
  };
}

export async function sha256(value: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

/**
 * Tags a workspace id with the relay's key. The unauthenticated sign-in pages
 * check it before touching any workspace, so made-up ids never reach one.
 */
export async function workspaceSignInTag(env: Env, workspaceId: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.RELAY_SECRET_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`mcp-sign-in|v1|${workspaceId}`),
    ),
  );
  return [...mac.slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Compares two hex digests without leaking where they differ. */
export function sameDigest(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

/** A sign-in link is single use and expires before binding to the browser. */
export async function pendingMcpSignIn(
  storage: DurableObjectStorage,
  startToken: string,
) {
  const request = mcpConnectionsFindOAuthRequest(storage, {
    startHash: await sha256(startToken),
  });
  if (!request || request.expires_at < Date.now() || request.binding_hash)
    throw new HttpError(
      410,
      "plugin_sign_in_expired",
      "This sign-in link has expired or was already used. Start again from Chief.",
    );
  return request;
}
