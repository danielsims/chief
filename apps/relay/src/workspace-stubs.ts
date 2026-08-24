import type { WorkspaceId } from "@chief/relay-contracts";

export function workspaceStub(env: Env, workspaceId: WorkspaceId) {
  return env.WORKSPACES.get(env.WORKSPACES.idFromName(workspaceId));
}

export function accountStub(env: Env, userId: string) {
  return env.ACCOUNTS.get(env.ACCOUNTS.idFromName(userId));
}
