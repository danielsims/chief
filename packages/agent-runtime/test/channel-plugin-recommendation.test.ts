import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentPluginSummary } from "@chief/plugin-api";
import type { JsonValue } from "@chief/relay-contracts";

import type { ChannelEvent } from "../src/channel-types.js";
import { handleChannelLocalTool } from "../src/channel-local-tools.js";
import { LocalStore } from "../src/local-store.js";

process.env.CHIEF_DATABASE_ENCRYPTION_KEY =
  "chief-channel-plugin-recommendation-test-key";

function request(path: string, body: JsonValue) {
  return new Request(`http://127.0.0.1:4318${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function plugin(id: string, name: string): AgentPluginSummary {
  return {
    id,
    name,
    description: `Connect ${name} to Chief.`,
    category: "Engineering",
    homepage: `https://${id}.com`,
    source: {
      type: "discovery",
      registry: "integrations.sh",
      domain: `${id}.com`,
    },
    status: "available",
    enabled: false,
    trusted: false,
  };
}

void test("plugin recommendations publish durable typed cards into an exact thread", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-plugin-recommend-"));
  const store = new LocalStore(join(directory, "chief.sqlite"));
  const published: ChannelEvent[] = [];
  const catalog = [plugin("vercel", "Vercel")];
  const context = {
    actor: { type: "agent" as const, id: "engineer", name: "Engineer" },
    channelStore: store.channelStore(),
    availableAgentIds: ["chief", "engineer"],
    onChannelEvent: (event: ChannelEvent) => {
      published.push(event);
    },
    plugins: {
      list: () => Promise.resolve({ plugins: catalog }),
      install: () => Promise.resolve({}),
      authorize: () => Promise.resolve({}),
      uninstall: () => Promise.resolve({}),
    },
  };
  try {
    const engineering = (await context.channelStore.list("workspace-a")).find(
      (channel) => channel.slug === "engineering",
    );
    assert.ok(engineering);
    const rootBody = {
      content: "I’m getting Engineering set up now.",
      idempotencyKey: "engineering-welcome",
    };
    const root = await handleChannelLocalTool(
      request(`/local-tools/channels/${engineering.id}/messages`, rootBody),
      "workspace-a",
      rootBody,
      context,
    );
    const rootEvent = (root.value as { event: ChannelEvent }).event;
    const recommendationBody = {
      content: "These are the two tools I’d connect first.",
      services: [
        "Vercel (vercel.com)",
        "GitHub (github.com)",
        "Missing service",
      ],
      threadRootId: "channel-api:engineering-welcome",
      idempotencyKey: "engineering-welcome-plugins",
    };
    const first = await handleChannelLocalTool(
      request(
        `/local-tools/channels/${engineering.id}/plugins/recommend`,
        recommendationBody,
      ),
      "workspace-a",
      recommendationBody,
      context,
    );
    const second = await handleChannelLocalTool(
      request(
        `/local-tools/channels/${engineering.id}/plugins/recommend`,
        recommendationBody,
      ),
      "workspace-a",
      recommendationBody,
      context,
    );
    const result = first.value as {
      event: Extract<ChannelEvent, { kind: 9 }>;
      plugins: AgentPluginSummary[];
      missingServices: string[];
    };
    assert.deepEqual(
      result.plugins.map((item) => item.id),
      ["vercel", "setup-github-com"],
    );
    assert.deepEqual(result.missingServices, ["Missing service"]);
    assert.deepEqual(result.plugins[1], {
      id: "setup-github-com",
      name: "GitHub",
      description: "Connect GitHub through Chief's secure setup flow.",
      category: "Productivity",
      homepage: "https://github.com",
      domains: ["github.com"],
      source: { type: "setup", domain: "github.com" },
      status: "available",
      enabled: false,
      trusted: false,
    });
    assert.deepEqual(result.event.parts, [
      {
        type: "data-plugin-recommendations",
        data: { plugins: result.plugins },
      },
    ]);
    assert.ok(
      result.event.tags.some(
        (tag) => tag[0] === "e" && tag[1] === rootEvent.id && tag[3] === "root",
      ),
    );
    assert.equal(
      (second.value as { event: ChannelEvent }).event.id,
      result.event.id,
    );
    assert.equal(published.length, 2);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
