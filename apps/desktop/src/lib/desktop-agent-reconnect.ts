import type { RelayClient } from "@chief/relay-client";
import { RelayClientError } from "@chief/relay-client";
import { hexPubkeySchema } from "@chief/relay-contracts";

interface LocalIdentity {
  agentId: string;
  pubkey: string;
}

/** Replacing identities needs one explicit choice, only when a mismatch occurs. */
export async function registerDesktopAgentKeys(
  identities: LocalIdentity[],
  workspace: Pick<RelayClient, "registerAgentKey">,
  confirmReconnect: (agentIds: string[]) => Promise<boolean>,
) {
  const conflicts: (LocalIdentity & { previousPubkey: string })[] = [];
  const registered = new Set<string>();
  await Promise.all(
    identities.map(async (identity) => {
      try {
        await workspace.registerAgentKey(identity.agentId, identity.pubkey);
        registered.add(identity.agentId);
      } catch (error) {
        if (
          !(error instanceof RelayClientError) ||
          error.status !== 409 ||
          error.code !== "agent_key_already_registered"
        )
          throw error;
        const previous = hexPubkeySchema.safeParse(error.details?.pubkey);
        if (!previous.success) throw error;
        conflicts.push({ ...identity, previousPubkey: previous.data });
      }
    }),
  );
  if (
    conflicts.length > 0 &&
    (await confirmReconnect(conflicts.map(({ agentId }) => agentId)))
  ) {
    await Promise.all(
      conflicts.map(async ({ agentId, pubkey, previousPubkey }) => {
        await workspace.registerAgentKey(agentId, pubkey, previousPubkey);
        registered.add(agentId);
      }),
    );
  }
  return registered;
}
