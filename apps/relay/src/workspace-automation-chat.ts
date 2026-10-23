import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";

import type { Principal } from "@chief/relay-contracts";
import {
  automationChatSchema,
  conversationIdSchema,
} from "@chief/relay-contracts";

import type { WorkspaceChannelStore } from "./workspace-channel-store";
import { HttpError, json, parseJson } from "./http";
import { channelMembersInsertDirectMembers } from "./queries/channel-members/insert-direct-members";
import { channelsFindChannelsCreate } from "./queries/channels/find-channels-create";
import { channelsInsertDirectsStart } from "./queries/channels/insert-directs-start";
import { readWorkspaceSchedule } from "./workspace-schedule-store";

/**
 * An automation's chat with Chief: a direct conversation of its own, kept off
 * the sidebar, so it only shows on the automation's page. Its description is
 * the automation's id, which is how Chief's brief finds the automation.
 */
const prefix = "automation-chat-";

/** True for an automation's chat, which no channel list or sidebar shows. */
export function isAutomationChat(conversationId: string) {
  return conversationId.startsWith(prefix);
}

const openSchema = z.object({ session: z.string().min(1).max(64) });
const chatRowSchema = z.object({
  conversation_id: z.string().startsWith(prefix),
  description: z.string().min(1),
});

export async function openAutomationChat(
  channels: WorkspaceChannelStore,
  workspaceId: string,
  principal: Principal,
  scheduleId: string,
  request: Request,
) {
  if (principal.kind !== "user")
    throw new HttpError(
      403,
      "automation_chat_people_only",
      "Only people chat about an automation.",
    );
  const { session } = openSchema.parse(await parseJson(request));
  const conversationId = conversationIdSchema.parse(
    `${prefix}${bytesToHex(
      sha256(
        new TextEncoder().encode(
          `${scheduleId}:${principal.userId}:${session}`,
        ),
      ),
    ).slice(0, 32)}`,
  );
  if (!channelsFindChannelsCreate(channels.storage, conversationId).length) {
    const now = new Date().toISOString();
    channels.storage.transactionSync(() => {
      channelsInsertDirectsStart(channels.storage, {
        conversationId,
        workspaceId,
        name: "Automation chat",
        description: scheduleId,
        createdByKind: "user",
        createdById: principal.userId,
        createdAt: now,
        updatedAt: now,
      });
      channelMembersInsertDirectMembers(channels.storage, {
        conversationId,
        ownerKind: "user",
        ownerId: principal.userId,
        ownerJoinedAt: now,
        memberConversationId: conversationId,
        memberKind: "agent",
        memberId: "chief",
        memberJoinedAt: now,
      });
    });
  }
  return json(automationChatSchema.parse({ conversationId }));
}

/** What Chief is told before each message in an automation's chat. */
export function automationChatBrief(
  storage: DurableObjectStorage,
  channel: { conversation_id: SqlStorageValue; description: SqlStorageValue },
) {
  const chat = chatRowSchema.safeParse(channel);
  if (!chat.success) return undefined;
  const id = chat.data.description;
  const title = readWorkspaceSchedule(storage, id)?.schedule.title;
  return [
    title
      ? `You're on the page of the automation "${title}" (id ${id}), with the person building it.`
      : `You're on the page of a new automation (id ${id}), with the person building it.`,
    "Build or change it as they ask: save it with recurring_work_propose and that id, find tools for steps with automations_tools, then test it with automations_test and read the results with automations_inspect. Keep replies short.",
  ].join(" ");
}
