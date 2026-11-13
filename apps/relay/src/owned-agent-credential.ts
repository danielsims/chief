import { jwtVerify, SignJWT } from "jose";

import type { AgentId, HexPubkey, WorkspaceId } from "@chief/relay-contracts";
import {
  agentIdSchema,
  hexPubkeySchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { AuthenticationError } from "./auth";

/**
 * An owned agent's short-lived credential. It is issued only after the agent
 * signs a fresh relay challenge, names the public key it is bound to, and is
 * useless without that key: every request carrying it must also be signed.
 * Revocation is not encoded here; the workspace checks it on every request.
 */
export const ownedAgentCredentialHeader = "x-chief-agent-credential";

export interface OwnedAgentCredentialEnvironment {
  AUTH_BASE_URL: string;
  BETTER_AUTH_SECRET: string;
}

const audience = "relay-owned-agent";
const tokenType = "chief-owned-agent+jwt";
export const OWNED_AGENT_CREDENTIAL_LIFETIME_SECONDS = 15 * 60;

export async function issueOwnedAgentCredential(
  env: OwnedAgentCredentialEnvironment,
  input: { agentId: AgentId; pubkey: HexPubkey; workspaceId: WorkspaceId },
) {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const expiresAt = issuedAt + OWNED_AGENT_CREDENTIAL_LIFETIME_SECONDS;
  const credential = await new SignJWT({
    pubkey: input.pubkey,
    wid: input.workspaceId,
  })
    .setProtectedHeader({ alg: "HS256", typ: tokenType })
    .setIssuer(issuer(env))
    .setAudience(audience)
    .setSubject(input.agentId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(await signingKey(env));
  return {
    credential,
    expiresAt: new Date(expiresAt * 1_000).toISOString(),
  };
}

export async function verifyOwnedAgentCredential(
  env: OwnedAgentCredentialEnvironment,
  credential: string | null,
  expected: { pubkey: HexPubkey; workspaceId: WorkspaceId },
) {
  try {
    if (!credential || credential.length > 4_096) {
      throw new Error("Missing agent credential.");
    }
    const { payload, protectedHeader } = await jwtVerify(
      credential,
      await signingKey(env),
      { issuer: issuer(env), audience, algorithms: ["HS256"] },
    );
    if (protectedHeader.typ !== tokenType) {
      throw new Error("Unexpected agent credential type.");
    }
    const pubkey = hexPubkeySchema.parse(payload.pubkey);
    const workspaceId = workspaceIdSchema.parse(payload.wid);
    if (pubkey !== expected.pubkey || workspaceId !== expected.workspaceId) {
      throw new Error("Agent credential binding mismatch.");
    }
    return { agentId: agentIdSchema.parse(payload.sub), pubkey, workspaceId };
  } catch {
    throw new AuthenticationError(
      "This agent credential is invalid or expired. Request a new one.",
    );
  }
}

async function signingKey(env: OwnedAgentCredentialEnvironment) {
  const material = new TextEncoder().encode(
    `chief-owned-agent-credential-v1\0${env.BETTER_AUTH_SECRET}`,
  );
  return new Uint8Array(await crypto.subtle.digest("SHA-256", material));
}

function issuer(env: OwnedAgentCredentialEnvironment) {
  return env.AUTH_BASE_URL.replace(/\/$/u, "");
}
