import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AgentAppearanceContext,
  AgentAvatar,
} from "../src/components/agent-avatar";
import { agentProviderBrand } from "../src/lib/agent-provider-brand";
import { WORKSPACE_AGENT_IDENTITIES } from "../src/lib/workspace-channels";

void test("plugin rows retain every authored Chief colour and recognize local provider brands", () => {
  const appearance = {
    providerMarks: new Map(),
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
  assert.equal(agentProviderBrand("claude"), "claude");
  assert.equal(agentProviderBrand("codex"), "codex");
  assert.equal(agentProviderBrand("opencode"), "opencode");
  assert.equal(agentProviderBrand("openCodeGo"), "opencode");
});
