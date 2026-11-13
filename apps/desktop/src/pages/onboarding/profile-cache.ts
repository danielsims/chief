import type { RelayClient } from "@chief/relay-client";
import type { AccountProfile } from "@chief/relay-contracts";
import { accountProfileSchema } from "@chief/relay-contracts";

import { readLocalCache, writeLocalCache } from "../../lib/local-cache";

const reads = new Map<string, Promise<AccountProfile>>();
export function cachedSetupProfile(key: string) {
  return readLocalCache(`${key}:profile`, accountProfileSchema) ?? null;
}
export function rememberSetupProfile(key: string, profile: AccountProfile) {
  writeLocalCache(`${key}:profile`, profile);
}
export function loadSetupProfile(
  client: Pick<RelayClient, "accountProfile">,
  key: string,
) {
  const current = reads.get(key);
  if (current) return current;
  const read = client
    .accountProfile()
    .then((profile) => {
      rememberSetupProfile(key, profile);
      return profile;
    })
    .finally(() => reads.delete(key));
  reads.set(key, read);
  return read;
}
