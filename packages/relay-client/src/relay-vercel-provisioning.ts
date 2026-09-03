import type {
  EveAgentProvisioningInput,
  EveAgentProvisioningProgress,
  EveAgentProvisioningResult,
  VercelDestinationCatalog,
} from "@chief/relay-contracts";
import {
  eveAgentProvisioningInputSchema,
  eveAgentProvisioningResultSchema,
  eveAgentProvisioningStreamEventSchema,
  vercelDestinationCatalogSchema,
  workspaceSecretListResultSchema,
  workspaceSecretResultSchema,
} from "@chief/relay-contracts";

import { RelayClientBase } from "./relay-client-base";
import { RelayClientError } from "./relay-client-error";

export async function readEveAgentProvisioningStream(
  response: Response,
  onProgress?: (progress: EveAgentProvisioningProgress) => void,
): Promise<EveAgentProvisioningResult> {
  if (!response.body)
    throw new Error("Relay returned an empty deployment stream.");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let result: EveAgentProvisioningResult | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = eveAgentProvisioningStreamEventSchema.parse(JSON.parse(line));
    if (event.kind === "progress") onProgress?.(event.progress);
    else if (event.kind === "complete") result = event.result;
    else throw new RelayClientError(event.message, 400, event.code);
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += value ?? "";
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
    if (done) break;
  }
  consume(buffer);
  if (!result)
    throw new Error("Relay deployment stream ended before completion.");
  return eveAgentProvisioningResultSchema.parse(result);
}

export class RelayVercelProvisioning extends RelayClientBase {
  async connectVercel(token: string): Promise<VercelDestinationCatalog> {
    return await this.fetchJson(
      this.workspaceUrl("vercel/connect"),
      vercelDestinationCatalogSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      },
    );
  }

  async listVercelDestinations(
    teamId?: string,
  ): Promise<VercelDestinationCatalog> {
    const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
    return await this.fetchJson(
      this.workspaceUrl(`vercel/destinations${query}`),
      vercelDestinationCatalogSchema,
      true,
    );
  }

  async provisionVercelEve(
    input: EveAgentProvisioningInput,
    onProgress?: (progress: EveAgentProvisioningProgress) => void,
  ): Promise<EveAgentProvisioningResult> {
    const response = await this.fetchResponse(
      this.workspaceUrl("vercel/provision"),
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(eveAgentProvisioningInputSchema.parse(input)),
      },
    );
    if (!response.ok) throw await RelayClientError.fromResponse(response);
    return readEveAgentProvisioningStream(response, onProgress);
  }

  async setWorkspaceSecret(name: string, value: string) {
    return await this.fetchJson(
      this.workspaceUrl("secrets"),
      workspaceSecretResultSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, value }),
      },
    );
  }

  async listWorkspaceSecrets() {
    return (
      await this.fetchJson(
        this.workspaceUrl("secrets"),
        workspaceSecretListResultSchema,
        true,
      )
    ).secrets;
  }

  async deleteWorkspaceSecret(name: string) {
    return await this.fetchJson(
      this.workspaceUrl(`secrets?name=${encodeURIComponent(name)}`),
      workspaceSecretResultSchema,
      true,
      { method: "DELETE" },
    );
  }
}
