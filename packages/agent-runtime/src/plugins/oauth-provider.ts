import { timingSafeEqual } from "node:crypto";

import type { StoredOAuthSession } from "../mcp-oauth.js";
import { McpOAuthProvider, parseStoredOAuthSession } from "../mcp-oauth.js";
import { workspaceSecrets } from "../workspace-secrets.js";

export type { StoredOAuthSession } from "../mcp-oauth.js";
export {
  accessTokenExpired,
  oauthConnectionStatus,
  oauthSessionConnected,
  requiresConfiguredOAuthClient,
} from "../mcp-oauth.js";

const pluginHostPort = process.env.CHIEF_PLUGIN_HOST_PORT?.trim() ?? "4318";
export const PLUGIN_OAUTH_CALLBACK_URL = `http://127.0.0.1:${pluginHostPort}/plugins/oauth/callback`;

function secretName(pluginId: string, serverName: string) {
  const safe = `${pluginId}-${serverName}`.replace(/[^A-Za-z0-9._-]/g, "_");
  return `plugin-oauth-${safe}.json`;
}

export async function readOAuthSession(
  workspaceId: string,
  pluginId: string,
  serverName: string,
): Promise<StoredOAuthSession | undefined> {
  try {
    const value = await workspaceSecrets.readPrivate(
      workspaceId,
      secretName(pluginId, serverName),
    );
    return value ? parseStoredOAuthSession(value) : undefined;
  } catch {
    return undefined;
  }
}

export async function writeOAuthSession(
  workspaceId: string,
  pluginId: string,
  serverName: string,
  session: StoredOAuthSession,
) {
  await workspaceSecrets.storePrivate(
    workspaceId,
    secretName(pluginId, serverName),
    JSON.stringify(session),
  );
}

export function deleteOAuthSession(
  workspaceId: string,
  pluginId: string,
  serverName: string,
) {
  return workspaceSecrets.deletePrivate(
    workspaceId,
    secretName(pluginId, serverName),
  );
}

export function oauthStateMatches(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The desktop runtime's provider: the shared session, stored locally. */
export class ChiefOAuthProvider extends McpOAuthProvider {
  constructor(
    workspaceId: string,
    pluginId: string,
    serverName: string,
    session: StoredOAuthSession,
  ) {
    super(session, {
      redirectUrl: PLUGIN_OAUTH_CALLBACK_URL,
      clientMetadata: {
        client_name: "Chief",
        client_uri: "https://github.com/latent-supply/chief",
        redirect_uris: [PLUGIN_OAUTH_CALLBACK_URL],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      },
      allowAuthorizationUrl: (url) =>
        url.protocol === "https:" || url.hostname === "127.0.0.1",
      persist: (value) =>
        writeOAuthSession(workspaceId, pluginId, serverName, value),
    });
  }
}
