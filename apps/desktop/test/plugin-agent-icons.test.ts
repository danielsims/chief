import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { onboardingAgents } from "@chief/relay-contracts";

import {
  AgentAppearanceContext,
  AgentAvatar,
} from "../src/components/agent-avatar";
import { agentProviderBrand } from "../src/lib/agent-provider-brand";
import { WORKSPACE_AGENT_IDENTITIES } from "../src/lib/workspace-channels";

void test("plugin rows retain every authored Chief colour and recognize local provider brands", () => {
  const appearance = {
    providerMarks: new Map(
      onboardingAgents.map((agent) => [
        agent.id,
        {
          Mark: () => createElement("span", null, "provider-logo"),
          tileClassName: "provider-tile",
        },
      ]),
    ),
    agentIds: new Map(),
    avatars: new Map(),
  };
  const render = (id: string) =>
    renderToStaticMarkup(
      createElement(
        AgentAppearanceContext.Provider,
        { value: appearance },
        createElement(AgentAvatar, { agentId: id }),
      ),
    );
  for (const [id, identity] of Object.entries(WORKSPACE_AGENT_IDENTITIES))
    assert.ok(render(id).includes(identity.color), id);
  for (const agent of onboardingAgents) {
    assert.ok(render(agent.id).includes(agent.color), agent.id);
    assert.ok(!render(agent.id).includes("provider-logo"), agent.id);
  }
  assert.equal(agentProviderBrand("claude"), "claude");
  assert.equal(agentProviderBrand("codex"), "codex");
  assert.equal(agentProviderBrand("chatgpt"), "codex");
  assert.equal(agentProviderBrand("opencode"), "opencode");
  assert.equal(agentProviderBrand("openCodeGo"), "opencode");
});

void test("explicit images and styles override Chief defaults while invited agents keep provider marks", () => {
  const appearance = {
    agentIds: new Map(),
    avatars: new Map([
      [
        "researcher",
        { kind: "image" as const, url: "https://example.test/avatar.png" },
      ],
      [
        "planner",
        {
          kind: "style" as const,
          color: "#123456",
          shape: "circle" as const,
          glyph: "P",
        },
      ],
    ]),
    providerMarks: new Map(
      ["chatgpt", "claude", "opencode"].map((id) => [
        id,
        {
          Mark: () => createElement("span", null, `${id}-logo`),
          tileClassName: "provider-tile",
        },
      ]),
    ),
  };
  const render = (agentId: string) =>
    renderToStaticMarkup(
      createElement(
        AgentAppearanceContext.Provider,
        { value: appearance },
        createElement(AgentAvatar, { agentId }),
      ),
    );
  assert.match(render("researcher"), /avatar\.png/u);
  assert.match(render("planner"), /#123456/u);
  for (const provider of ["chatgpt", "claude", "opencode"])
    assert.match(render(provider), new RegExp(`${provider}-logo`, "u"));
});
