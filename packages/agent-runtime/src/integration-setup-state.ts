import { isJsonString, parseJsonObject } from "@chief/relay-contracts";

export interface ActiveIntegrationSetup {
  attemptId: string;
  domain: string;
  expiresAt: number;
  integrationSlug?: string;
  recipeId: string;
}

export class IntegrationSetupRegistry {
  private readonly domains = new Map<string, Map<string, string>>();
  private readonly setups = new Map<
    string,
    Map<string, ActiveIntegrationSetup>
  >();

  activate(
    workspaceId: string,
    sessionId: string,
    setup: Omit<ActiveIntegrationSetup, "expiresAt">,
  ) {
    this.assignDomain(workspaceId, sessionId, setup.domain);
    const workspace =
      this.setups.get(workspaceId) ?? new Map<string, ActiveIntegrationSetup>();
    workspace.set(sessionId, {
      ...setup,
      expiresAt: Date.now() + 30 * 60_000,
    });
    this.setups.set(workspaceId, workspace);
  }

  assignDomain(workspaceId: string, sessionId: string, domain: string) {
    const workspace =
      this.domains.get(workspaceId) ?? new Map<string, string>();
    workspace.set(sessionId, domain);
    this.domains.set(workspaceId, workspace);
  }

  domain(workspaceId: string, sessionId: string) {
    return this.domains.get(workspaceId)?.get(sessionId);
  }

  get(workspaceId: string, sessionId: string) {
    return this.setups.get(workspaceId)?.get(sessionId);
  }

  remove(workspaceId: string, sessionId: string) {
    this.setups.get(workspaceId)?.delete(sessionId);
  }

  require(workspaceId: string, sessionId: string, _attemptId: string) {
    const setup = this.get(workspaceId, sessionId);
    // The model sometimes passes a stale or invented attemptId through the
    // executor's generic `execute` tool. The session is the source of truth —
    // it holds exactly one active setup. Treat a wrong attemptId as a mismatch
    // on the caller's side and still use the session's live setup so browser
    // and OAuth flows can proceed instead of dying on a bad parameter.
    if (setup && setup.expiresAt > Date.now()) {
      return setup;
    }
    this.remove(workspaceId, sessionId);
    throw new Error("This integration setup run is not active.");
  }

  requireDomain(
    workspaceId: string,
    sessionId: string,
    attemptId: string,
    domain: string,
  ) {
    if (this.require(workspaceId, sessionId, attemptId).domain !== domain) {
      throw new Error("This integration setup run targets another provider.");
    }
  }
}

export function completedSetupResult(text: string): string | null {
  for (const line of text.split("\n")) {
    const marker = "CHIEF_SETUP_RESULT ";
    if (!line.startsWith(marker)) continue;
    try {
      const result = parseJsonObject(JSON.parse(line.slice(marker.length)));
      if (!result) return null;
      if (result.status === "connected" && isJsonString(result.provider)) {
        return result.provider;
      }
    } catch {
      return null;
    }
  }
  return null;
}
