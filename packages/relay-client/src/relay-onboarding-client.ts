import {
  accountProfileSchema,
  ownedAgentChannelResultSchema,
  ownedAgentConnectCodeSchema,
  ownedAgentDecisionResultSchema,
  ownedAgentListSchema,
  ownedAgentRequestListSchema,
  ownedAgentRevokedSchema,
  usernameAvailabilitySchema,
  usernameSetResultSchema,
  workspaceSnapshotSchema,
} from "@chief/relay-contracts";

import { RelayVercelProvisioning } from "./relay-vercel-provisioning";

export class RelayOnboardingClient extends RelayVercelProvisioning {
  createOwnedAgentInvite() {
    return this.fetchJson(
      this.workspaceUrl("owned-agents/codes"),
      ownedAgentConnectCodeSchema,
      true,
      { method: "POST" },
    );
  }
  ownedAgentRequests() {
    return this.fetchJson(
      this.workspaceUrl("owned-agents/requests"),
      ownedAgentRequestListSchema,
    );
  }
  ownedAgents() {
    return this.fetchJson(
      this.workspaceUrl("owned-agents"),
      ownedAgentListSchema,
    );
  }
  decideOwnedAgent(requestId: string, approve: boolean) {
    return this.fetchJson(
      this.workspaceUrl(
        `owned-agents/requests/${encodeURIComponent(requestId)}/${approve ? "approve" : "deny"}`,
      ),
      ownedAgentDecisionResultSchema,
      true,
      { method: "POST" },
    );
  }
  setOwnedAgentChannel(agentId: string, channelId: string, member: boolean) {
    return this.fetchJson(
      this.workspaceUrl(
        `owned-agents/${encodeURIComponent(agentId)}/channels/${encodeURIComponent(channelId)}`,
      ),
      ownedAgentChannelResultSchema,
      true,
      { method: member ? "PUT" : "DELETE" },
    );
  }
  revokeOwnedAgent(agentId: string) {
    return this.fetchJson(
      this.workspaceUrl(`owned-agents/${encodeURIComponent(agentId)}/revoke`),
      ownedAgentRevokedSchema,
      true,
      { method: "POST" },
    );
  }
  setupSnapshot() {
    return this.fetchJson(this.workspaceUrl("setup"), workspaceSnapshotSchema);
  }
  finishWorkspaceSetup(selectedApps?: string[]) {
    return this.fetchJson(
      this.workspaceUrl("setup/complete"),
      workspaceSnapshotSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selectedApps }),
      },
    );
  }

  accountProfile() {
    return this.fetchJson(
      new URL("/v1/me/profile", this.relayUrl),
      accountProfileSchema,
    );
  }
  usernameAvailability(candidate: string) {
    const url = new URL("/v1/me/username", this.relayUrl);
    url.searchParams.set("candidate", candidate);
    return this.fetchJson(url, usernameAvailabilitySchema);
  }
  setUsername(username: string) {
    return this.fetchJson(
      new URL("/v1/me/username", this.relayUrl),
      usernameSetResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username }),
      },
    );
  }
}
