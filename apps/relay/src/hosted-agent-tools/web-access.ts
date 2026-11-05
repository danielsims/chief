import type { BrowserWorker } from "@cloudflare/puppeteer";

import {
  isJsonString,
  parseJsonObject,
  webMachineFetchResultSchema,
} from "@chief/relay-contracts";

import type { HostedAgentToolContext } from "./context";
import { launchBrowser } from "../cloudflare-agent-browser";
import { workspaceOperation } from "./toolkits/channels";

/**
 * How hosted agents reach the web from Cloudflare. Plain fetches are fast but
 * many sites refuse them from a datacenter; a real Chrome from Browser
 * Rendering gets through most of those, so it's the fallback, not the default.
 */

export const chromeUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const challengeText =
  /captcha|unusual traffic|are you a robot|verify you are human|attention required|just a moment\.\.\.|cf-chl|enable javascript and cookies/i;

/** A page that loaded but is a bot wall rather than the content. */
export function isChallengePage(html: string) {
  return challengeText.test(html.slice(0, 20_000));
}

/** Loads a page in a real Chrome and returns its final URL and HTML. */
export async function readWithChrome(binding: BrowserWorker, url: string) {
  const browser = await launchBrowser(binding);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(chromeUserAgent);
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 25_000,
    });
    // Script-built pages fill in after the first paint.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const html = await page.content();
    const status = response?.status() ?? 0;
    if (status >= 400 || isChallengePage(html))
      throw new Error(`The web page refused a real browser (HTTP ${status}).`);
    return { url: page.url(), html };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

// Failures per site within one agent turn. Past the budget the site is closed
// for the turn, so an agent moves on instead of retrying a wall.
const failureBudget = 3;
const failures = new Map<string, { count: number; at: number }>();

function failureKey(turn: string, url: string) {
  return `${turn} ${new URL(url).hostname.replace(/^www\./u, "")}`;
}

export function requireSiteOpen(turn: string, url: string) {
  const entry = failures.get(failureKey(turn, url));
  if (entry && entry.count >= failureBudget)
    throw new Error(
      `${new URL(url).hostname} has failed ${entry.count} times this turn. Don't try it again; use another source or what you already have.`,
    );
}

export function recordSiteFailure(turn: string, url: string) {
  const key = failureKey(turn, url);
  const now = Date.now();
  // Old turns age out so the map stays small.
  for (const [other, entry] of failures)
    if (now - entry.at > 60 * 60_000) failures.delete(other);
  failures.set(key, { count: (failures.get(key)?.count ?? 0) + 1, at: now });
}

/**
 * Fetches through a member's machine that has lent this workspace its
 * connection and admits this agent, from that machine's own IP. Undefined
 * when no such machine is online or it couldn't fetch the page, so the
 * caller carries on in the cloud.
 */
export async function fetchThroughMachine(
  context: Pick<HostedAgentToolContext, "env" | "job" | "principal">,
  url: string,
) {
  const author = parseJsonObject(
    parseJsonObject(context.job.payload.message)?.author,
  );
  try {
    const result = webMachineFetchResultSchema.parse(
      await workspaceOperation(
        context.env,
        context.job,
        context.principal,
        "machine-web-fetch",
        {
          body: {
            url,
            ...(author?.kind === "user" && isJsonString(author.id)
              ? { requesterUserId: author.id }
              : undefined),
          },
        },
      ),
    );
    if (!result.ok || result.status >= 400 || isChallengePage(result.body))
      return undefined;
    return result;
  } catch {
    return undefined;
  }
}
