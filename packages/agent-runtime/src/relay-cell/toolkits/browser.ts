import { join } from "node:path";

import type { JsonObject } from "@chief/relay-contracts";
import { AgentBrowserSession } from "@chief/browser/node";
import { parseJsonString } from "@chief/relay-contracts";

import type { RelayCellTool } from "../tool.js";
import { clickBrowserDefinition } from "../../tools/toolkits/browser/click-browser.js";
import { closeBrowserDefinition } from "../../tools/toolkits/browser/close-browser.js";
import { fillBrowserDefinition } from "../../tools/toolkits/browser/fill-browser.js";
import { openBrowserDefinition } from "../../tools/toolkits/browser/open-browser.js";
import { pressBrowserDefinition } from "../../tools/toolkits/browser/press-browser.js";
import { selectBrowserDefinition } from "../../tools/toolkits/browser/select-browser.js";
import { snapshotBrowserDefinition } from "../../tools/toolkits/browser/snapshot-browser.js";
import { requiredEnvironment } from "../context.js";
import { optionalString, requiredString, requiredStrings } from "../input.js";
import { defineRelayCellTool } from "../tool.js";

// One browser per conversation; a worker runs many conversations' jobs.
let browser: { conversationId: string; session: AgentBrowserSession } | null =
  null;

function browserSession() {
  const conversationId = requiredEnvironment("CHIEF_CONVERSATION_ID");
  if (browser?.conversationId === conversationId) return browser.session;
  const session = new AgentBrowserSession({
    sessionId: `${requiredEnvironment("CHIEF_AGENT_ID")}-${conversationId}`,
    downloadPath: join(
      requiredEnvironment("CHIEF_CELL_ROOT"),
      "browser",
      conversationId,
    ),
    encryptionKey: requiredEnvironment("CHIEF_AGENT_SECRET_KEY"),
    restore: true,
    colorScheme: "dark",
  });
  browser = { conversationId, session };
  return session;
}

function publicHttpsUrl(raw: string) {
  const url = new URL(raw);
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  const privateAddress =
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    /^(?:127|10|0)\./u.test(hostname) ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("169.254.") ||
    /^172\.(?:1[6-9]|2\d|3[01])\./u.test(hostname) ||
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    privateAddress
  ) {
    throw new Error("url must be a public HTTPS address without credentials.");
  }
  return url.toString();
}

function browserTargets(input: JsonObject) {
  const ref = optionalString(input, "ref");
  const labels = Array.isArray(input.labels)
    ? input.labels.flatMap((value) => {
        const parsed = parseJsonString(value)?.trim();
        return parsed ? [parsed] : [];
      })
    : [];
  const targets = [...(ref ? [ref.replace(/^@?/u, "@")] : []), ...labels];
  if (targets.length === 0) throw new Error("ref or labels are required.");
  return targets;
}

async function snapshot() {
  return await browserSession().snapshot();
}

/**
 * A browser tool as this agent sees it: the plain definition, without the
 * conversation and run fields the desktop fills in for its own browser. This
 * runtime always browses in the run's own conversation.
 */
function browserTool(
  definition: RelayCellTool["definition"],
  execute: RelayCellTool["execute"],
): RelayCellTool {
  return {
    ...defineRelayCellTool(
      definition.operation.operationId,
      "browser.use",
      execute,
    ),
    definition,
  };
}

export const relayCellBrowserTools = [
  browserTool(openBrowserDefinition, async (_context, input) => {
    const session = browserSession();
    if (input.fresh === true) await session.close();
    await session.open(publicHttpsUrl(requiredString(input, "url")), {
      width: 1280,
      height: 800,
    });
    return await session.snapshot();
  }),
  browserTool(snapshotBrowserDefinition, snapshot),
  browserTool(clickBrowserDefinition, async (_context, input) => {
    await browserSession().click(browserTargets(input));
    return await snapshot();
  }),
  browserTool(fillBrowserDefinition, async (_context, input) => {
    await browserSession().fill(
      browserTargets(input),
      requiredString(input, "value"),
    );
    return await snapshot();
  }),
  browserTool(selectBrowserDefinition, async (_context, input) => {
    await browserSession().select(
      browserTargets(input),
      requiredStrings(input, "values"),
    );
    return await snapshot();
  }),
  browserTool(pressBrowserDefinition, async (_context, input) => {
    await browserSession().press(requiredString(input, "key"));
    return await snapshot();
  }),
  browserTool(closeBrowserDefinition, async () => {
    await browserSession().close();
    return { closed: true };
  }),
];
