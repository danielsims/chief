import type { BrowserWorker } from "@cloudflare/puppeteer";
import puppeteer from "@cloudflare/puppeteer";
import { z } from "zod";

import { UnavailableToolError } from "@chief/agent-runtime/durable-turn";

export async function launchBrowser(binding: BrowserWorker) {
  const limits = await puppeteer.limits(binding).catch(() => undefined);
  const delay = browserAcquisitionDelay(limits);
  if (delay > 0) throw browserCapacityUnavailable(delay);
  try {
    return await puppeteer.launch(binding);
  } catch (error) {
    if (!isBrowserAcquisitionRateLimit(error)) throw error;
    if (isDailyBrowserLimit(error)) {
      throw new UnavailableToolError(
        "Cloudflare Browser Run has reached its daily allowance. Do not retry the browser today; continue with another available research tool.",
      );
    }
    const refreshed = await puppeteer.limits(binding).catch(() => undefined);
    throw browserCapacityUnavailable(
      Math.max(
        browserAcquisitionDelay(refreshed),
        retryAfterMilliseconds(error),
        1_000,
      ),
    );
  }
}

export function browserAcquisitionDelay(
  limits: Awaited<ReturnType<typeof puppeteer.limits>> | undefined,
) {
  if (!limits) return 0;
  if (limits.activeSessions.length >= limits.maxConcurrentSessions)
    return 5_000;
  if (limits.allowedBrowserAcquisitions > 0) return 0;
  return Math.max(limits.timeUntilNextAllowedBrowserAcquisition, 1_000);
}

function isBrowserAcquisitionRateLimit(error: unknown): error is Error {
  return (
    error instanceof Error &&
    /(?:code:\s*429|status(?: code)?:?\s*429|too many requests|rate.?limit|unable to create (?:a )?browser)/iu.test(
      error.message,
    )
  );
}

function isDailyBrowserLimit(error: unknown) {
  return (
    error instanceof Error &&
    /(?:browser time limit exceeded|daily allowance)/iu.test(error.message)
  );
}

function browserCapacityUnavailable(delay: number) {
  return new UnavailableToolError(
    `Cloudflare Browser Run is temporarily at capacity for about ${Math.ceil(delay / 1_000)} seconds. Continue now with web_read, another source, or the evidence already available.`,
  );
}

function retryAfterMilliseconds(error: Error) {
  const parsed = z.object({ headers: z.instanceof(Headers) }).safeParse(error);
  const retryAfter = parsed.success
    ? parsed.data.headers.get("Retry-After")
    : undefined;
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 0;
}
