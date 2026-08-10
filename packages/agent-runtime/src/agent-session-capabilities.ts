import { createHash, randomBytes } from "node:crypto";

export type AgentSessionCapability =
  | { kind: "workspace-gateway"; workspaceId: string }
  | {
      kind: "agent-session";
      workspaceId: string;
      agentId: string;
      sessionId: string;
      expiresAt: number;
    };

interface IssuedSessionToken {
  token: string;
  digest: string;
  expiresAt: number;
  agentId: string;
}

/**
 * Host-owned bearer capabilities for Chief's loopback API. Secrets exist only
 * in memory; lookup keys are SHA-256 digests and agent credentials expire.
 */
export class AgentSessionCapabilityRegistry {
  private readonly capabilities = new Map<string, AgentSessionCapability>();
  private readonly workspaceTokens = new Map<string, string>();
  private readonly sessionTokens = new Map<string, IssuedSessionToken>();

  private digest(token: string) {
    return createHash("sha256").update(token).digest("base64url");
  }

  workspaceGateway(workspaceId: string) {
    const existing = this.workspaceTokens.get(workspaceId);
    if (existing) return existing;
    const token = randomBytes(32).toString("base64url");
    this.workspaceTokens.set(workspaceId, token);
    this.capabilities.set(this.digest(token), {
      kind: "workspace-gateway",
      workspaceId,
    });
    return token;
  }

  agentSession(
    input: { workspaceId: string; agentId: string; sessionId: string },
    now = Date.now(),
  ) {
    const key = `${input.workspaceId}\0${input.sessionId}`;
    const existing = this.sessionTokens.get(key);
    if (
      existing?.agentId === input.agentId &&
      existing.expiresAt > now + 60_000
    ) {
      return existing.token;
    }
    if (existing) this.capabilities.delete(existing.digest);
    const token = `chief_agent_${randomBytes(32).toString("base64url")}`;
    const digest = this.digest(token);
    const expiresAt = now + 12 * 60 * 60_000;
    this.sessionTokens.set(key, {
      token,
      digest,
      expiresAt,
      agentId: input.agentId,
    });
    this.capabilities.set(digest, {
      kind: "agent-session",
      ...input,
      expiresAt,
    });
    return token;
  }

  authenticate(token: string, now = Date.now()) {
    const capability = this.capabilities.get(this.digest(token));
    if (capability?.kind === "agent-session" && capability.expiresAt <= now) {
      this.capabilities.delete(this.digest(token));
      return undefined;
    }
    return capability;
  }
}
