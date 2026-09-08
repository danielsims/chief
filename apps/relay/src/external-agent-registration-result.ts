import { z } from "zod";

import {
  agentSummarySchema,
  externalAgentRegistrationResultSchema,
} from "@chief/relay-contracts";

import type { WorkspaceSecretStore } from "./workspace-secret-store";
import { HttpError, json } from "./http";

export async function externalAgentRegistrationReplay(
  workspaceId: string,
  runtime: {
    token_secret_ref: string;
    delivery_signing_key_id: string;
    delivery_signing_secret_ref: string;
    registration_result_json: string | null;
  },
  secrets: WorkspaceSecretStore,
) {
  if (!runtime.registration_result_json)
    throw new HttpError(
      500,
      "external_agent_registration_corrupt",
      "The external registration result is unavailable.",
    );
  const stored = z
    .object({
      agent: agentSummarySchema,
      channel: z.object({ inboundUrl: z.url() }),
    })
    .parse(JSON.parse(runtime.registration_result_json));
  const [token, deliverySigningSecret] = await Promise.all([
    secrets.get(workspaceId, runtime.token_secret_ref),
    secrets.get(workspaceId, runtime.delivery_signing_secret_ref),
  ]);
  if (!token || !deliverySigningSecret)
    throw new HttpError(
      500,
      "external_agent_registration_corrupt",
      "The external channel credential is unavailable.",
    );
  return json(
    externalAgentRegistrationResultSchema.parse({
      agent: stored.agent,
      channel: {
        inboundUrl: stored.channel.inboundUrl,
        token,
        deliverySigningKeyId: runtime.delivery_signing_key_id,
        deliverySigningSecret,
      },
    }),
  );
}
