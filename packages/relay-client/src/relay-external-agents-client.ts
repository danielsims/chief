import type { ExternalAgentRegistrationPayload } from "@chief/relay-contracts";
import {
  eveWorkspaceKickoffResultSchema,
  externalAgentConnectionVerificationInputSchema,
  externalAgentConnectionVerificationResultSchema,
  externalAgentCredentialRotationResultSchema,
  externalAgentDisconnectResultSchema,
  externalAgentEndpointUpdateResultSchema,
  externalAgentReconciliationListSchema,
  externalAgentRecoveryResultSchema,
  externalAgentRegistrationResultSchema,
} from "@chief/relay-contracts";

import { RelayClientBase } from "./relay-client-base";

export class RelayExternalAgentsClient extends RelayClientBase {
  async startWorkspaceKickoff() {
    return await this.fetchJson(
      this.workspaceUrl("onboarding/start"),
      eveWorkspaceKickoffResultSchema,
      true,
      { method: "POST" },
    );
  }

  async verifyConnection(agentId: string, selectedApps?: readonly string[]) {
    return await this.fetchJson(
      this.workspaceUrl(
        `agents/${encodeURIComponent(agentId)}/external/verify`,
      ),
      externalAgentConnectionVerificationResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          externalAgentConnectionVerificationInputSchema.parse({
            selectedApps,
          }),
        ),
      },
    );
  }
  async register(input: ExternalAgentRegistrationPayload) {
    return await this.fetchJson(
      this.workspaceUrl("agents/external"),
      externalAgentRegistrationResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          protocolVersion: 1,
          occurredAt: new Date().toISOString(),
          payload: input,
        }),
      },
    );
  }

  async disconnect(agentId: string) {
    return await this.fetchJson(
      this.workspaceUrl(`agents/${encodeURIComponent(agentId)}/external`),
      externalAgentDisconnectResultSchema,
      true,
      { method: "DELETE" },
    );
  }

  async updateEndpoint(agentId: string, endpoint: string) {
    return await this.fetchJson(
      this.workspaceUrl(
        `agents/${encodeURIComponent(agentId)}/external/endpoint`,
      ),
      externalAgentEndpointUpdateResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint }),
      },
    );
  }

  async rotateCredentials(agentId: string) {
    return await this.fetchJson(
      this.workspaceUrl(
        `agents/${encodeURIComponent(agentId)}/external/credentials/rotate`,
      ),
      externalAgentCredentialRotationResultSchema,
      true,
      { method: "POST" },
    );
  }

  async reconciliations(agentId: string) {
    return await this.fetchJson(
      this.workspaceUrl(
        `agents/${encodeURIComponent(agentId)}/channel/deliveries/reconciling`,
      ),
      externalAgentReconciliationListSchema,
      true,
    );
  }

  async recoverDelivery(
    agentId: string,
    deliveryId: string,
    decision: "inspect" | "resend" | "drop",
  ) {
    return await this.fetchJson(
      this.workspaceUrl(
        `agents/${encodeURIComponent(agentId)}/channel/deliveries/${encodeURIComponent(deliveryId)}/recover`,
      ),
      externalAgentRecoveryResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    );
  }
}
