import { join } from "node:path";

import type { JsonObject } from "@chief/relay-contracts";
import { AgentBrowserSession } from "@chief/browser/node";
import { parseJsonString } from "@chief/relay-contracts";

import { requiredEnvironment } from "../context.js";
import { optionalString, requiredString, requiredStrings } from "../input.js";
import { defineRelayCellTool } from "../tool.js";

let browser: AgentBrowserSession | null = null;

function browserSession() {
  if (browser) return browser;
  const conversationId = requiredEnvironment("CHIEF_CONVERSATION_ID");
  browser = new AgentBrowserSession({
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
  return browser;
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

export const relayCellBrowserTools = [
  defineRelayCellTool(
    "browser.open",
    "browser.use",
    async (_context, input) => {
      const session = browserSession();
      if (input.fresh === true) await session.close();
      await session.open(publicHttpsUrl(requiredString(input, "url")), {
        width: 1280,
        height: 800,
      });
      return await session.snapshot();
    },
  ),
  defineRelayCellTool("browser.snapshot", "browser.use", snapshot),
  defineRelayCellTool(
    "browser.click",
    "browser.use",
    async (_context, input) => {
      await browserSession().click(browserTargets(input));
      return await snapshot();
    },
  ),
  defineRelayCellTool(
    "browser.fill",
    "browser.use",
    async (_context, input) => {
      await browserSession().fill(
        browserTargets(input),
        requiredString(input, "value"),
      );
      return await snapshot();
    },
  ),
  defineRelayCellTool(
    "browser.select",
    "browser.use",
    async (_context, input) => {
      await browserSession().select(
        browserTargets(input),
        requiredStrings(input, "values"),
      );
      return await snapshot();
    },
  ),
  defineRelayCellTool(
    "browser.press",
    "browser.use",
    async (_context, input) => {
      await browserSession().press(requiredString(input, "key"));
      return await snapshot();
    },
  ),
  defineRelayCellTool("browser.close", "browser.use", async () => {
    await browserSession().close();
    return { closed: true };
  }),
];
