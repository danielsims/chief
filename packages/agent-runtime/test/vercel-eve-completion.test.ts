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

interface EveRoute {
  path: string;
  handler: (request: Request, operations: EveOperations) => Promise<Response>;
}
interface EveOperations {
  from: (address: string) => { send: () => Promise<{ id: string }> };
}

function loadChiefChannel(
  requests: ReturnType<typeof externalAgentInboundMessageSchema.parse>[],
) {
  const code = ts.transpileModule(chiefChannelSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return runInNewContext(`${code}; exports.default`, {
    exports: {},
    URL,
    Response,
    console,
    process: {
      env: {
        CHIEF_AGENT_ID: "chief",
        CHIEF_WORKSPACE_ID: "workspace",
        CHIEF_RELAY_URL: "https://relay.test",
        CHIEF_CHANNEL_TOKEN: "token",
        VERCEL_DEPLOYMENT_ID: "dpl_current",
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
                POST: (path: string, handler: EveRoute["handler"]) => ({
                  path,
                  handler,
                }),
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
  }) as EveDefinition & { routes: (EveRoute | null)[] };
}

void test("Eve reports turn completion even after a tool published the visible reply", async () => {
  const requests: ReturnType<typeof externalAgentInboundMessageSchema.parse>[] =
    [];
  const exported = loadChiefChannel(requests);
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

void test("Eve starts a fresh session for a conversation on each deployment", async () => {
  const addresses: string[] = [];
  const route = loadChiefChannel([]).routes.find(
    (candidate) => candidate?.path === "/channels/chief/messages",
  );
  assert.ok(route);
  const response = await route.handler(
    new Request("https://eve.test/channels/chief/messages", {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: JSON.stringify({
        payload: {
          deliveryId: "delivery",
          sessionAddress: "chief_conversation",
          continuation: { capability: "capability" },
          message: { body: "Are you there?" },
        },
      }),
    }),
    {
      from: (address) => {
        addresses.push(address);
        return { send: () => Promise.resolve({ id: "session" }) };
      },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(addresses, ["chief_conversation:dpl_current"]);
});
