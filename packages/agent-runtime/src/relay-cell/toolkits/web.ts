import { rm } from "node:fs/promises";
import { join } from "node:path";

import { AgentBrowserSession } from "@chief/browser/node";

import type { WebReadPage } from "../../tools/web-reading.js";
import {
  currentTime,
  fetchPlain,
  googleBrowserSearch,
  isChallengePage,
  isTimeZone,
  MAX_TEXT_LENGTH,
  pageFrom,
  publicWebUrl,
} from "../../tools/web-reading.js";
import { requiredEnvironment } from "../context.js";
import { optionalString, requiredString } from "../input.js";
import { defineRelayCellTool } from "../tool.js";

/**
 * Loads a page in its own browser that nobody is shown, for the agent's own
 * reading, then closes it. The conversation's shown browser is untouched.
 */
async function readInBackground(url: string): Promise<WebReadPage> {
  const sessionId = crypto.randomUUID();
  const downloadPath = join(
    requiredEnvironment("CHIEF_CELL_ROOT"),
    "browser-read",
    sessionId,
  );
  const session = new AgentBrowserSession({
    sessionId: `${requiredEnvironment("CHIEF_AGENT_ID")}-read-${sessionId}`,
    downloadPath,
    encryptionKey: requiredEnvironment("CHIEF_AGENT_SECRET_KEY"),
    restore: false,
    colorScheme: "dark",
    publicWebOnly: true,
  });
  try {
    await session.open(url);
    const page = await session.snapshot({ includeText: true });
    return {
      url: page.url,
      title: page.title,
      text: page.snapshot,
      controls: [],
    };
  } finally {
    await session.close().catch(() => undefined);
    await rm(downloadPath, { recursive: true, force: true });
  }
}

export const relayCellWebTools = [
  defineRelayCellTool("web.read", "workspace.read", async (_context, input) => {
    const url = publicWebUrl(requiredString(input, "url")).toString();
    try {
      const page = await fetchPlain(url);
      return pageFrom(publicWebUrl(page.url), page.body, page.contentType);
    } catch (error) {
      // A site that refuses a plain fetch gets one try in a real browser.
      const page = await readInBackground(url).catch(() => {
        throw error;
      });
      const challenged = isChallengePage(page.text);
      return {
        ...page,
        text: page.text.slice(0, MAX_TEXT_LENGTH),
        links: [],
        browserUsed: true,
        status: challenged ? "verification_required" : "loaded",
        ...(challenged
          ? {
              action:
                "The source requires verification in a browser. Do not retry or treat this page as source evidence.",
            }
          : undefined),
      };
    }
  }),
  defineRelayCellTool("web.search", "browser.use", async (_context, input) =>
    googleBrowserSearch(readInBackground, requiredString(input, "query")),
  ),
  defineRelayCellTool("time.now", "workspace.read", (_context, input) => {
    const asked = optionalString(input, "timeZone");
    if (asked && !isTimeZone(asked))
      throw new Error(
        `${asked} isn't an IANA time zone, such as America/New_York.`,
      );
    // A local agent runs on its person's own computer, in their zone.
    const user = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return Promise.resolve(
      currentTime(new Date(), {
        user,
        ...(asked ? { asked } : undefined),
      }),
    );
  }),
];
