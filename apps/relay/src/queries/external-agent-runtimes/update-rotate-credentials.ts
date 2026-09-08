import { eq } from "drizzle-orm";

import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentRuntimes } from "../../db/schema/external-agent-runtimes";

export function externalAgentRuntimesUpdateRotateCredentials(
  storage: DurableObjectStorage,
  {
    tokenHash,
    deliverySigningKeyId,
    deliverySigningSecretRef,
    updatedAt,
    agentId,
  }: {
    tokenHash: string;
    deliverySigningKeyId: string;
    deliverySigningSecretRef: string;
    updatedAt: string;
    agentId: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db
        .update(externalAgentRuntimes)
        .set({
          token_hash: tokenHash,
          delivery_signing_key_id: deliverySigningKeyId,
          delivery_signing_secret_ref: deliverySigningSecretRef,
          connection_status: "pending_setup",
          updated_at: updatedAt,
        })
        .where(eq(externalAgentRuntimes.agent_id, agentId)),
    ),
  );
}
