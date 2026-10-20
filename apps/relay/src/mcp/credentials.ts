import { z } from "zod";

import type { StoredOAuthSession } from "@chief/agent-runtime/mcp-oauth";
import { parseStoredOAuthSession } from "@chief/agent-runtime/mcp-oauth";

import type { SealPurpose } from "../sealed-secret";
import { mcpConnectionsDeleteCredential } from "../queries/mcp-connections/delete-credential";
import { mcpConnectionsFindCredential } from "../queries/mcp-connections/find-credential";
import { mcpConnectionsUpsertCredential } from "../queries/mcp-connections/upsert-credential";
import { openSecret, sealSecret } from "../sealed-secret";

/**
 * Credentials for one MCP connection, sealed with their own key (see
 * sealed-secret.ts). The additional data names the workspace, connection and
 * server, so a ciphertext copied elsewhere fails to open. Nothing here is
 * ever serialised into a response, a prompt or a log.
 */
const keyInfo = "chief/mcp-credentials/v1";
const envelopeVersion = "m1";

export type McpCredential =
  | { kind: "headers"; headers: { name: string; value: string }[] }
  | { kind: "oauth"; session: StoredOAuthSession };

const headersCredentialSchema = z.object({
  kind: z.literal("headers"),
  headers: z.array(z.object({ name: z.string(), value: z.string() })).max(8),
});

const oauthCredentialSchema = z.object({
  kind: z.literal("oauth"),
  session: z.record(z.string(), z.unknown()),
});

const purpose: SealPurpose = { info: keyInfo, version: envelopeVersion };

/** Binds a ciphertext to its workspace, connection and server address. */
function additionalData(
  workspaceId: string,
  connectionId: string,
  serverUrl: string,
) {
  return JSON.stringify([
    "mcp-credential",
    1,
    workspaceId,
    connectionId,
    serverUrl,
  ]);
}

export class McpCredentialStore {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly master: string,
    private readonly workspaceId: string,
  ) {}

  async read(
    connectionId: string,
    serverUrl: string,
  ): Promise<McpCredential | undefined> {
    const row = mcpConnectionsFindCredential(this.storage, connectionId);
    if (!row) return undefined;
    const plaintext = await openSecret(
      this.master,
      purpose,
      additionalData(this.workspaceId, connectionId, serverUrl),
      row.sealed,
    );
    const value: unknown = JSON.parse(plaintext);
    const headers = headersCredentialSchema.safeParse(value);
    if (headers.success) return headers.data;
    const oauth = oauthCredentialSchema.safeParse(value);
    const session = oauth.success
      ? parseStoredOAuthSession(JSON.stringify(oauth.data.session))
      : undefined;
    if (!session) throw new Error("Stored plugin credentials are unreadable.");
    return { kind: "oauth", session };
  }

  async write(
    connectionId: string,
    serverUrl: string,
    credential: McpCredential,
  ) {
    mcpConnectionsUpsertCredential(this.storage, {
      connectionId,
      sealed: await sealSecret(
        this.master,
        purpose,
        additionalData(this.workspaceId, connectionId, serverUrl),
        JSON.stringify(credential),
      ),
      updatedAt: Date.now(),
    });
  }

  delete(connectionId: string) {
    mcpConnectionsDeleteCredential(this.storage, connectionId);
  }
}
