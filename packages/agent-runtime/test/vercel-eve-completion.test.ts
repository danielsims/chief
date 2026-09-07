import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";

import { externalAgentInboundMessageSchema } from "@chief/relay-contracts";

import { chiefChannelSource } from "../src/vercel-eve-chief-channel.js";

interface EveEvent {
  turnId: string;
  message?: string;
  finishReason?: string;
}
interface EveChannel {
  state: {
    deliveryId: string;
    capability: string;
    agentId: string;
    conversationId: string;
    messageId: string;
    threadRootId: string;
  };
}
interface EveContext {
  session: { id: string };
}
interface EveDefinition {
  events: Record<
    string,
    (event: EveEvent, channel: EveChannel, context: EveContext) => Promise<void>
  >;
}

void test("Eve reports turn completion even after a tool published the visible reply", async () => {
  const requests: ReturnType<typeof externalAgentInboundMessageSchema.parse>[] =
    [];
  const code = ts.transpileModule(chiefChannelSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exported = runInNewContext(`${code}; exports.default`, {
    exports: {},
    URL,
    console,
    process: {
      env: {
        CHIEF_AGENT_ID: "chief",
        CHIEF_WORKSPACE_ID: "workspace",
        CHIEF_RELAY_URL: "https://relay.test",
        CHIEF_CHANNEL_TOKEN: "token",
      },
    },
    require: (name: string) =>
      name === "node:crypto"
        ? crypto
        : name === "zod"
          ? { z }
          : name === "eve/channels"
            ? {
                defineChannel: (value: EveDefinition) => value,
                GET: () => null,
                POST: () => null,
              }
            : {
                hasChiefMessagePosted: () => true,
                setCurrentChiefDelivery: () => undefined,
              },
    fetch: async (_url: URL, init: RequestInit) => {
      requests.push(
        externalAgentInboundMessageSchema.parse(
          await new Response(init.body).json(),
        ),
      );
      return Response.json({ ok: true });
    },
  }) as EveDefinition;
  const channel = {
    state: {
      deliveryId: "delivery",
      capability: "c".repeat(43),
      agentId: "chief",
      conversationId: "channel",
      messageId: "root",
      threadRootId: "root",
    },
  };
  const context = { session: { id: "session" } };
  const onMessage = exported.events["message.completed"];
  const onComplete = exported.events["turn.completed"];
  assert.ok(onMessage);
  assert.ok(onComplete);
  await onMessage(
    {
      turnId: "turn",
      message: "Already posted the plan.",
      finishReason: "stop",
    },
    channel,
    context,
  );
  assert.equal(requests.length, 0);
  await onComplete({ turnId: "turn" }, channel, context);
  await onComplete({ turnId: "turn" }, channel, context);
  assert.equal(requests.length, 1);
  const receipt = requests[0];
  assert.ok(receipt);
  assert.equal(receipt.publish, false);
  assert.equal(receipt.complete, true);
  assert.equal(receipt.outcome, "completed");
});
