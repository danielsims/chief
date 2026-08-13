import type { SessionManager } from "./manager.js";

/** Silently include the owner in General for legacy workspaces. */
export async function ensureOnboardingGeneralChannel(input: {
  manager: SessionManager;
  workspaceId: string;
  onChannelsChanged: () => void | Promise<void>;
}) {
  const store = input.manager.store.channelStore();
  let channel = (await store.list(input.workspaceId)).find(
    (candidate) => candidate.slug === "general",
  );
  if (!channel) return;

  if (!channel.userIds.includes("workspace-owner")) {
    channel =
      (await store.addUsers(input.workspaceId, channel.id, [
        "workspace-owner",
      ])) ?? channel;
    await input.onChannelsChanged();
  }
}
