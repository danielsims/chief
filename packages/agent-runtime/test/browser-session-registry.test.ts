import assert from "node:assert/strict";
import test from "node:test";

import type { AgentBrowserSession } from "@chief/browser/node";

import { BrowserSessionRegistry } from "../src/browser-session-registry.js";

void test("deduplicates an already applied browser viewport", async () => {
  const viewports: [number, number][] = [];
  const session = {
    setViewport: (width: number, height: number) => {
      viewports.push([width, height]);
      return Promise.resolve();
    },
  } as AgentBrowserSession;
  const registry = new BrowserSessionRegistry(() => session);

  await registry.resize("workspace", "conversation", {
    width: 700,
    height: 1_021,
  });
  await registry.resize("workspace", "conversation", {
    width: 700,
    height: 1_021,
  });

  assert.deepEqual(viewports, [[700, 1_021]]);
});
