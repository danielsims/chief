import { z } from "zod";

import type { WorkspaceChannel } from "@chief/agent-runtime/types";
import {
  channelAgentPermissions,
  channelKinds,
  channelLifecycleStates,
  channelWorkstreamStatuses,
} from "@chief/channel-api";

const storedChannelSchema = z.object({
  protocol: z.literal("nip29"),
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  topic: z.string(),
  description: z.string(),
  agentIds: z.array(z.string()),
  userIds: z.array(z.string()),
  visibility: z.enum(["public", "private", "direct"]).optional(),
  directUserId: z.string().optional(),
  kind: z.enum(channelKinds),
  lifecycle: z.enum(channelLifecycleStates),
  archivedAt: z.number().optional(),
  createdBy: z.object({
    type: z.enum(["user", "agent"]),
    id: z.string(),
    name: z.string(),
  }),
  agentPermissions: z.array(z.enum(channelAgentPermissions)),
  workstream: z
    .object({
      status: z.enum(channelWorkstreamStatuses),
      repository: z.string().optional(),
      baseBranch: z.string().optional(),
      branch: z.string().optional(),
      pullRequestUrls: z.array(z.string()),
    })
    .optional(),
  version: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

function storageKey(workspaceId: string) {
  return `chief:workspace-channels:v1:${workspaceId}`;
}

/**
 * The channel list from the last session, so launch paints the sidebar's
 * channels together with its DMs instead of waiting for the relay.
 */
export function readStoredWorkspaceChannels(
  workspaceId: string,
): WorkspaceChannel[] | undefined {
  try {
    const parsed = z
      .array(storedChannelSchema)
      .safeParse(
        JSON.parse(
          window.localStorage.getItem(storageKey(workspaceId)) ?? "null",
        ),
      );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function storeWorkspaceChannels(
  workspaceId: string,
  channels: readonly WorkspaceChannel[],
) {
  try {
    window.localStorage.setItem(
      storageKey(workspaceId),
      JSON.stringify(channels),
    );
  } catch {
    // Storage can be full or unavailable; the sidebar still renders live data.
  }
}
