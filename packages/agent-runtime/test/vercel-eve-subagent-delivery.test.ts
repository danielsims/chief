import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";

import type { JsonObject } from "@chief/relay-contracts";
import { jsonObjectSchema } from "@chief/relay-contracts";

import { eveProjectFiles } from "../src/vercel-eve-files.js";

type Callback = (
  event: JsonObject,
  context: JsonObject,
  runtime?: JsonObject,
) => Promise<void> | Definition | null;
interface Definition {
  events: Record<string, Callback>;
  metadata: (state: Record<string, string>) => Record<string, string>;
}

interface GeneratedModule {
  default?: Definition;
}
interface DeliveryState {
  delivery: JsonObject | null;
  published: boolean;
  delegated: boolean;
}

void test("only the actual declared child publishes and completes an addressed Eve handoff", async () => {
  const files = new Map(
    eveProjectFiles({
      teamId: "test",
      project: { kind: "new", projectName: "test" },
      agent: {
        id: "chief",
        name: "Chief",
        description: "Lead",
        instructions: "Coordinate work.",
        model: "test",
        subagents: [
          {
            id: "brand",
            name: "Marketer",
            role: "Marketing",
            description: "Creates content",
            instructions: "Create useful content.",
          },
        ],
      },
      environment: {
        CHIEF_AGENT_ID: "chief",
        CHIEF_CHANNEL_TOKEN: "test-token",
        CHIEF_WORKSPACE_ID: "test",
        CHIEF_RELAY_URL: "https://relay.test",
        CHIEF_DELIVERY_SIGNING_KEY_ID: "test",
        CHIEF_DELIVERY_SIGNING_SECRET: "test",
      },
    }).map((file) => [file.path, file.contents]),
  );
  let activeSession = "parent";
  const state = new Map<string, DeliveryState>();
  const modules = new Map<string, GeneratedModule>();
  const requests: { url: string; body: JsonObject }[] = [];
  const load = (file: string): GeneratedModule => {
    const cached = modules.get(file);
    if (cached) return cached;
    const source = files.get(file);
    assert.ok(source, file);
    const exports: GeneratedModule = {};
    modules.set(file, exports);
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    runInNewContext(code, {
      exports,
      URL,
      Buffer,
      console,
      process: {
        env: {
          CHIEF_AGENT_ID: "chief",
          CHIEF_CHANNEL_TOKEN: "test-token",
          CHIEF_WORKSPACE_ID: "test",
          CHIEF_RELAY_URL: "https://relay.test",
        },
      },
      fetch: async (url: URL, init: RequestInit) => {
        requests.push({
          url: String(url),
          body: jsonObjectSchema.parse(await new Response(init.body).json()),
        });
        return Response.json({ ok: true });
      },
      require: (name: string) => {
        if (name === "node:crypto") return crypto;
        if (name === "zod") return { z };
        if (name === "eve/context")
          return {
            defineState: (key: string, initial: () => DeliveryState) => ({
              get: () => state.get(activeSession + key) ?? initial(),
              update: (fn: (value: DeliveryState) => DeliveryState) =>
                state.set(
                  activeSession + key,
                  fn(state.get(activeSession + key) ?? initial()),
                ),
            }),
          };
        if (name.startsWith("eve/"))
          return {
            defineChannel: (value: Definition) => value,
            defineHook: (value: Definition) => value,
            defineDynamic: (value: Definition) => value,
            defineInstructions: (value: Definition) => value,
            GET: () => null,
            POST: () => null,
          };
        return load(
          path.posix.normalize(path.posix.join(path.posix.dirname(file), name)),
        );
      },
    });
    return exports;
  };
  const channel = load("agent/channels/chief.ts").default;
  const rootInstructions = load("agent/instructions/chief_delivery.ts").default;
  const childInstructions = load(
    "agent/subagents/brand/instructions/chief_delivery.ts",
  ).default;
  const child = load("agent/subagents/brand/hooks/chief.ts").default;
  assert.ok(channel);
  assert.ok(rootInstructions);
  assert.ok(childInstructions);
  assert.ok(child);
  const delivery = {
    deliveryId: "delivery",
    capability: "secret-capability",
    agentId: "brand",
    conversationId: "marketing",
    messageId: "root",
    threadRootId: "root",
  };
  const metadata = channel.metadata(delivery);
  assert.ok(!JSON.stringify(metadata).includes("secret-capability"));
  await rootInstructions.events["turn.started"]?.(
    {},
    { session: { id: "parent" }, channel: { metadata } },
  );
  await channel.events["action.result"]?.(
    {
      status: "completed",
      result: {
        toolName: "brand",
        output: { status: "working", taskId: "task", agentId: "child" },
      },
    },
    { state: delivery },
    { session: { id: "parent" } },
  );
  await channel.events["message.completed"]?.(
    { turnId: "plan", message: "Marketer is working.", finishReason: "stop" },
    { state: delivery },
    { session: { id: "parent" } },
  );
  await channel.events["turn.completed"]?.(
    { turnId: "plan" },
    { state: delivery },
    { session: { id: "parent" } },
  );
  assert.equal(
    requests.length,
    0,
    "a background receipt is not completed work or a Marketer reply",
  );
  activeSession = "child";
  await childInstructions.events["turn.started"]?.(
    {},
    { session: { id: "child" }, channel: { metadata } },
  );
  const childContext = {
    session: { id: "child", parent: { rootSessionId: "parent" } },
  };
  await child.events["message.completed"]?.(
    {
      data: {
        turnId: "work",
        message: "Here is the finished marketing post.",
        finishReason: "stop",
      },
    },
    childContext,
  );
  await child.events["turn.completed"]?.(
    { data: { turnId: "work" } },
    childContext,
  );
  assert.equal(requests.length, 2);
  assert.ok(
    requests.every((request) =>
      request.url.includes("/agents/brand/channel/messages"),
    ),
  );
  const [reply, completion] = requests;
  assert.ok(reply);
  assert.ok(completion);
  assert.equal(reply.body.body, "Here is the finished marketing post.");
  assert.equal(reply.body.sessionId, "parent");
  assert.equal(reply.body.complete, false);
  assert.equal(completion.body.complete, true);
  assert.equal(completion.body.publish, false);
});
