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

/**
 * Give every completed onboarding a visible Engineering room, including
 * workspaces created by builds that predate the default channel.
 */
export async function ensureOnboardingEngineeringChannel(input: {
  manager: SessionManager;
  workspaceId: string;
  onChannelsChanged: () => void | Promise<void>;
}) {
  const store = input.manager.store.channelStore();
  const existingChannel = (await store.list(input.workspaceId)).find(
    (candidate) => candidate.slug === "engineering",
  );
  let changed = !existingChannel;
  let channel =
    existingChannel ??
    (await store.create(input.workspaceId, {
      name: "engineering",
      description: "Product changes, bugs, and technical reviews",
      operationKey: "chief-default-engineering",
      actor: { type: "agent", id: "engineer", name: "Engineer" },
      agentIds: ["chief", "engineer"],
      userIds: ["workspace-owner"],
      agentPermissions: ["update_metadata"],
    }));
  const missingAgents = ["chief", "engineer"].filter(
    (agentId) => !channel.agentIds.includes(agentId),
  );
  if (missingAgents.length > 0) {
    channel =
      (await store.addAgents(input.workspaceId, channel.id, missingAgents)) ??
      channel;
    changed = true;
  }
  if (!channel.userIds.includes("workspace-owner")) {
    channel =
      (await store.addUsers(input.workspaceId, channel.id, [
        "workspace-owner",
      ])) ?? channel;
    changed = true;
  }
  if (changed) await input.onChannelsChanged();
  return channel;
}
