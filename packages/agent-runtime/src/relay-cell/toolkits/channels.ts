import { createHash, randomUUID } from "node:crypto";

import type { RelayClient } from "@chief/relay-client";
import type { JsonObject } from "@chief/relay-contracts";
import {
  appendMessageCommandSchema,
  parseJsonNumber,
} from "@chief/relay-contracts";

import { channelMembers, optionalString, requiredString } from "../input.js";
import { defineRelayCellTool } from "../tool.js";

function channelId(operationKey: string) {
  return `channel-${createHash("sha256").update(operationKey).digest("hex").slice(0, 24)}`;
}

function inferredMentions(body: string) {
  const identities: Record<string, string> = {
    chief: "chief",
    setup: "setup",
    marketer: "brand",
    content: "content",
    engineer: "engineer",
    analyst: "analyst",
    prospector: "prospector",
    advertising: "ads",
  };
  return [...body.matchAll(/@([A-Za-z][A-Za-z0-9_-]*)/gu)].flatMap((match) => {
    const id = identities[(match[1] ?? "").toLowerCase()];
    return id ? [id] : [];
  });
}

async function searchMessages(client: RelayClient, input: JsonObject) {
  const channel = optionalString(input, "channelId");
  const query = requiredString(input, "query");
  const limit = parseJsonNumber(input.limit) ?? 50;
  if (channel) return client.searchMessages(channel, query, { limit });
  const pages = await Promise.all(
    (await client.listChannels()).map((candidate) =>
      client.searchMessages(candidate.id, query, { limit }),
    ),
  );
  return { messages: pages.flatMap((page) => page.messages).slice(0, limit) };
}

export const relayCellChannelTools = [
  defineRelayCellTool("channels.list", "channels.read", async ({ client }) => ({
    channels: await client.listChannels(),
  })),
  defineRelayCellTool(
    "channels.members.list",
    "members.read",
    async ({ client }, input) => ({
      members: await client.listChannelMembers(
        requiredString(input, "channelId"),
      ),
    }),
  ),
  defineRelayCellTool(
    "channels.messages.list",
    "messages.read",
    async ({ client }, input) =>
      await client.listMessages(requiredString(input, "channelId"), {
        limit: parseJsonNumber(input.limit) ?? 50,
      }),
  ),
  defineRelayCellTool(
    "channels.messages.replies",
    "messages.read",
    async ({ client }, input) =>
      await client.listThreadReplies(
        requiredString(input, "channelId"),
        requiredString(input, "messageId"),
        { limit: parseJsonNumber(input.limit) ?? 50 },
      ),
  ),
  defineRelayCellTool(
    "channels.messages.search",
    "messages.read",
    async ({ client }, input) => await searchMessages(client, input),
  ),
  defineRelayCellTool(
    "channels.create",
    "channels.create",
    async ({ client }, input) => {
      const conversationId = channelId(requiredString(input, "operationKey"));
      const existing = (await client.listChannels()).find(
        (channel) => channel.id === conversationId,
      );
      if (existing) return { channel: existing, created: false };
      return {
        channel: await client.createChannel({
          conversationId,
          name: requiredString(input, "name"),
          isPrivate: input.visibility === "private",
        }),
        created: true,
      };
    },
  ),
  defineRelayCellTool(
    "channels.members.add",
    "members.manage",
    async ({ client }, input) => {
      const members = channelMembers(input);
      await client.addChannelMembers(
        requiredString(input, "channelId"),
        members,
      );
      return { added: members };
    },
  ),
  defineRelayCellTool(
    "channels.messages.post",
    "messages.send",
    async ({ client, agentId }, input) => {
      const conversationId = requiredString(input, "channelId");
      const body = requiredString(input, "content");
      const threadRootId = optionalString(input, "threadRootId");
      if (optionalString(input, "idempotencyKey")) {
        const existing = (
          await client.listMessages(conversationId, { limit: 200 })
        ).messages.find(
          (message) =>
            message.author.kind === "agent" &&
            message.author.id === agentId &&
            message.body === body &&
            message.threadRootId === threadRootId,
        );
        if (existing) return { message: existing, duplicate: true };
      }
      return await client.appendMessage(
        conversationId,
        appendMessageCommandSchema.parse({
          commandId: randomUUID(),
          protocolVersion: 1,
          occurredAt: new Date().toISOString(),
          payload: {
            messageId: randomUUID(),
            conversationId,
            threadRootId,
            body,
            mentions: inferredMentions(body),
            components: [],
          },
        }),
      );
    },
  ),
  defineRelayCellTool(
    "channels.reactions.add",
    "messages.send",
    async ({ client }, input) =>
      await client.reactToMessage(
        requiredString(input, "channelId"),
        requiredString(input, "messageId"),
        requiredString(input, "emoji"),
        true,
      ),
  ),
  defineRelayCellTool(
    "channels.reactions.remove",
    "messages.send",
    async ({ client }, input) =>
      await client.reactToMessage(
        requiredString(input, "channelId"),
        requiredString(input, "messageId"),
        requiredString(input, "emoji"),
        false,
      ),
  ),
];
