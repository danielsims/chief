import type { RelayClient } from "@chief/relay-client";
import type {
  AgentInferenceConfig,
  WorkspaceSnapshot,
} from "@chief/relay-contracts";

import type { SetupDraft } from "./model";

export const setupSecretName = (service: SetupDraft["service"]) =>
  service === "vercelAiGateway" ? "vercel-ai-gateway" : "opencode";

/** Reconfigure the existing team when connection settings change. */
export async function applySetupConnection(
  client: Pick<
    RelayClient,
    | "listWorkspaceSecrets"
    | "setWorkspaceSecret"
    | "loadAgentConfig"
    | "saveAgentConfig"
  >,
  snapshot: WorkspaceSnapshot,
  draft: SetupDraft,
  apiKey: string,
) {
  // Eve provisions its connection on the next screen.
  if (draft.location === "cloud" && draft.host === "vercel-eve") return;
  const local = draft.location === "device";
  const secretRef = setupSecretName(draft.service);
  if (!local) {
    if (apiKey.trim())
      await client.setWorkspaceSecret(secretRef, apiKey.trim());
    else if (
      !(await client.listWorkspaceSecrets()).some(
        (secret) => secret.name === secretRef,
      )
    )
      throw new Error("Paste an API key for the selected AI service.");
  }
  const inference: AgentInferenceConfig = local
    ? draft.localProvider === "opencode"
      ? { provider: "opencode", model: draft.localModel, secretRef: "opencode" }
      : { provider: draft.localProvider, model: draft.localModel }
    : draft.service === "opencode"
      ? {
          provider: "opencode",
          model: "opencode-go/gpt-6-luna",
          secretRef,
        }
      : {
          provider: "vercel-ai-gateway",
          model: "openai/gpt-6-luna",
          secretRef,
        };
  const chief = snapshot.agents.find((agent) => agent.id === "chief");
  for (const id of [
    "chief",
    ...(chief?.subagents.map((agent) => agent.id) ?? []),
  ]) {
    const { config } = await client.loadAgentConfig(id);
    const deploymentTarget = local ? "desktop" : "cloud";
    if (
      config.deploymentTarget === deploymentTarget &&
      config.inference.provider === inference.provider &&
      config.inference.model === inference.model &&
      ("secretRef" in config.inference
        ? config.inference.secretRef
        : undefined) ===
        ("secretRef" in inference ? inference.secretRef : undefined)
    )
      continue;
    await client.saveAgentConfig(id, {
      ...config,
      deploymentTarget,
      inference,
    });
  }
}
