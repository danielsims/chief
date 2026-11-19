import { UnavailableToolError } from "@chief/agent-runtime/durable-turn";
import {
  fetchPlain,
  googleBrowserSearch,
  isChallengePage,
  MAX_TEXT_LENGTH,
  pageFrom,
  publicWebUrl,
} from "@chief/agent-runtime/web-reading";

import type { HostedAgentToolContext } from "../context";
import { requiredString } from "../input";
import { defineHostedAgentTool } from "../tool";
import {
  fetchThroughMachine,
  readWithChrome,
  recordSiteFailure,
  requireSiteOpen,
} from "../web-access";

export const hostedWebTools = [
  defineHostedAgentTool(
    "web.read",
    async (context, input) => {
      const url = publicWebUrl(requiredString(input, "url")).toString();
      const page = await fetchPage(context, url);
      if ("snapshot" in page) return page.snapshot;
      return pageFrom(publicWebUrl(page.url), page.body, page.contentType);
    },
    { effect: "read_only" },
  ),
  defineHostedAgentTool(
    "web.search",
    async (context, input) => {
      const query = requiredString(input, "query");
      const read = context.browser?.read?.bind(context.browser);
      if (!read)
        throw new Error(
          "The browser is unavailable. Enable browser access for this agent; no alternate search engine will be used.",
        );
      return googleBrowserSearch(read, query);
    },
    { effect: "read_only", requiresBrowser: true },
  ),
];

/**
 * Every page an agent reads, search results included, comes through here: a
 * machine lent to the workspace if one is online, otherwise the cloud, where
 * a site that refuses a plain fetch gets one try in a real browser. A site
 * that keeps failing is closed for the rest of the turn.
 */
async function fetchPage(
  context: Pick<
    HostedAgentToolContext,
    "env" | "job" | "principal" | "browser"
  >,
  url: string,
) {
  requireSiteOpen(context.job.id, url);
  const lent = await fetchThroughMachine(context, url);
  if (lent) return lent;
  try {
    return await fetchPlain(url);
  } catch (error) {
    try {
      if (context.browser?.read) {
        const page = await context.browser.read(url);
        publicWebUrl(page.url);
        const challenged = isChallengePage(page.text);
        if (challenged) recordSiteFailure(context.job.id, url);
        return {
          snapshot: {
            url: page.url,
            title: page.title,
            text: page.text.slice(0, MAX_TEXT_LENGTH),
            links: [],
            controls: page.controls,
            browserUsed: true,
            status: challenged ? "verification_required" : "loaded",
            ...(challenged
              ? {
                  action:
                    "The source requires verification in a browser. Do not retry or treat this page as source evidence.",
                }
              : undefined),
          },
        };
      }
      const page = await readWithChrome(context.env.BROWSER, url);
      return { url: page.url, body: page.html, contentType: "text/html" };
    } catch (browserError) {
      recordSiteFailure(context.job.id, url);
      // A spent daily browser allowance is the reason worth reporting.
      throw browserError instanceof UnavailableToolError ? browserError : error;
    }
  }
}

export {
  googleBrowserSearch,
  readWebPage,
} from "@chief/agent-runtime/web-reading";
