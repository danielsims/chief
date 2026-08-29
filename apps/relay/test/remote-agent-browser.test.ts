import { expect, test } from "vitest";

import { RecoverableToolError } from "@chief/agent-runtime/durable-turn";

import { RemoteAgentBrowser } from "../src/remote-agent-browser.js";

test("a rejected browser interaction remains recoverable by the agent", async () => {
  const client = {
    json: () => Promise.reject(new Error("control no longer exists")),
    bytes: () => Promise.reject(new Error("control no longer exists")),
  };
  const browser = new RemoteAgentBrowser(client);

  const interaction = browser.click({ labels: ["Authorize"] });
  await expect(interaction).rejects.toBeInstanceOf(RecoverableToolError);
  await expect(interaction).rejects.toThrow("Inspect the current page");
});
