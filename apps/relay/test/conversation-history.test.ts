import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  agentPrincipalSchema,
  appendMessageCommandSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import type { ConversationObject } from "../src/conversation-object";
import { SqlConversationStore } from "../src/conversation-store";
import { hexKey, relayTestEnv } from "./helpers";

describe("agent conversation history", () => {
  it("returns the latest meaningful messages from the owning thread", async () => {
    const relay = relayTestEnv();
    const stub = relay.CONVERSATIONS.get(
      relay.CONVERSATIONS.idFromName("workspace-history:chief"),
    );
    await runInDurableObject(
      stub,
      async (_instance: ConversationObject, state) => {
        const store = new SqlConversationStore(state.storage);
        store.initialize();
        const rootId = append(store, "old request");
        for (let index = 0; index < 50; index += 1) append(store, "");
        append(store, "thread reply", rootId);
        append(store, "latest request");

        expect(
          store.history(undefined, 2).map((message) => message.body),
        ).toEqual(["old request", "latest request"]);
        expect(
          store.history(rootId, 10).map((message) => message.body),
        ).toEqual(["old request", "thread reply"]);
        expect(store.recent(2).messages.map((message) => message.body)).toEqual(
          ["thread reply", "latest request"],
        );
      },
    );
  });
});

function append(
  store: SqlConversationStore,
  body: string,
  threadRootId?: string,
) {
  const workspaceId = workspaceIdSchema.parse("workspace-history");
  const actor = agentPrincipalSchema.parse({
    kind: "agent",
    agentId: "chief",
    pubkey: hexKey("conversation-history"),
    workspaceId,
    role: "member",
  });
  const messageId = crypto.randomUUID();
  store.append({
    workspaceId,
    actor,
    author: { kind: "agent", id: actor.agentId },
    command: appendMessageCommandSchema.parse({
      commandId: crypto.randomUUID(),
      protocolVersion: 1,
      occurredAt: new Date().toISOString(),
      payload: {
        messageId,
        conversationId: "chief",
        ...(threadRootId ? { threadRootId } : undefined),
        body,
        mentions: [],
        components: [],
      },
    }),
  });
  return messageId;
}
