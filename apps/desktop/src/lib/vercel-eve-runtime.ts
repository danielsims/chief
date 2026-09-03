import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import type {
  EveAgentProvisioningInput,
  EveAgentProvisioningProgress,
  EveAgentProvisioningResult,
} from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import { provisionVercelEveDeployment } from "@chief/agent-runtime/vercel-eve-provisioning";

const vercelTokens = new Map<string, string>();

export function rememberVercelAccessToken(
  workspaceId: string | null | undefined,
  token: string,
) {
  const id = workspaceId?.trim();
  const value = token.trim();
  if (!id || !value) return;
  vercelTokens.set(id, value);
}

export function vercelFetcher(): typeof fetch {
  return isTauri() ? tauriFetch : globalThis.fetch;
}

export async function provisionEveAgent({
  client,
  input,
  onProgress,
}: {
  client: RelayClient;
  input: EveAgentProvisioningInput;
  onProgress?: (progress: EveAgentProvisioningProgress) => void;
}): Promise<EveAgentProvisioningResult> {
  const token = client.workspaceId
    ? vercelTokens.get(client.workspaceId)
    : undefined;
  if (!token) {
    return await client.provisionVercelEve(input, onProgress);
  }
  return await provisionVercelEveDeployment({
    token,
    input,
    fetcher: vercelFetcher(),
    onProgress,
  });
}
