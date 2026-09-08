import type {
  EveAgentProvisioningInput,
  EveAgentProvisioningProgress,
  EveAgentProvisioningResult,
} from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";

export async function provisionEveAgent({
  client,
  input,
  onProgress,
}: {
  client: RelayClient;
  input: EveAgentProvisioningInput;
  onProgress?: (progress: EveAgentProvisioningProgress) => void;
}): Promise<EveAgentProvisioningResult> {
  return await client.provisionVercelEve(input, onProgress);
}
