import { relayDatabase } from "../../db/connection";
import { executeDatabaseQuery } from "../../db/execute";
import { externalAgentRuntimes } from "../../db/schema/external-agent-runtimes";

export function externalAgentRuntimesInsertRegister(
  storage: DurableObjectStorage,
  {
    agentId,
    endpointUrl,
    tokenHash,
    tokenSecretRef,
    deliverySigningKeyId,
    deliverySigningSecretRef,
    registrationCommandId,
    registrationPayloadHash,
    registrationResultJson,
    replacesNative,
    createdAt,
    updatedAt,
  }: {
    agentId: string;
    endpointUrl: string;
    tokenHash: string;
    tokenSecretRef: string;
    deliverySigningKeyId: string;
    deliverySigningSecretRef: string;
    registrationCommandId: string;
    registrationPayloadHash: string;
    registrationResultJson: string | null;
    replacesNative: number;
    createdAt: string;
    updatedAt: string;
  },
) {
  const db = relayDatabase(storage);
  return executeDatabaseQuery(() =>
    db.run(
      db.insert(externalAgentRuntimes).values({
        agent_id: agentId,
        endpoint_url: endpointUrl,
        token_hash: tokenHash,
        token_secret_ref: tokenSecretRef,
        delivery_signing_key_id: deliverySigningKeyId,
        delivery_signing_secret_ref: deliverySigningSecretRef,
        registration_command_id: registrationCommandId,
        registration_payload_hash: registrationPayloadHash,
        registration_result_json: registrationResultJson,
        replaces_native: replacesNative,
        created_at: createdAt,
        updated_at: updatedAt,
      }),
    ),
  );
}
