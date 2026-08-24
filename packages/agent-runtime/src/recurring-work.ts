import { CronExpressionParser } from "cron-parser";

import { isJsonObject, isJsonString } from "@chief/relay-contracts";

function normalizedCron(cron: string) {
  const fields = cron.trim().split(/\s+/);
  if (fields.length === 5) return `0 ${fields.join(" ")}`;
  if (fields.length === 6) return fields.join(" ");
  throw new Error("Schedule must use a five-field cron expression.");
}

export function validateCron(cron: string, timezone: string) {
  CronExpressionParser.parse(normalizedCron(cron), {
    tz: timezone,
    strict: true,
  });
}

export function nextRunAt(cron: string, timezone: string, after = Date.now()) {
  return CronExpressionParser.parse(normalizedCron(cron), {
    currentDate: new Date(after),
    tz: timezone,
    strict: true,
  })
    .next()
    .toDate()
    .getTime();
}

/** The occurrence's calendar date (YYYY-MM-DD) in the work's timezone. */
export function runDateKey(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export function upcomingRuns(
  cron: string,
  timezone: string,
  after = Date.now(),
  count = 24,
) {
  const expression = CronExpressionParser.parse(normalizedCron(cron), {
    currentDate: new Date(after),
    tz: timezone,
    strict: true,
  });
  return expression.take(count).map((date) => date.toDate().getTime());
}

/**
 * Executor tool addresses referenced by an execute-snippet, excluding the
 * read-only catalog helpers (search/describe) that any run may use.
 */
export function executorAddressesFromCode(code: string): string[] {
  return [
    ...new Set([
      ...[...code.matchAll(/tools\.[A-Za-z0-9_.-]+/g)].map((match) => match[0]),
      ...[
        ...code.matchAll(
          /tools\[(["'])([A-Za-z0-9_.-]+)\1\]((?:\.[A-Za-z0-9_.-]+)*)/g,
        ),
      ].map((match) => `tools.${match[2]}${match[3]}`),
    ]),
  ].filter((address) => !/^tools\.(search|describe)(\.|$)/.test(address));
}

/**
 * Executor discovery helpers are read-only and do not widen an automation's
 * connector grant. Codex still asks before invoking the outer execute tool,
 * so recognise snippets that only discover or describe available tools.
 */
export function executorCodeUsesOnlyCatalogHelpers(code: string) {
  const addresses = [
    ...code.matchAll(/tools\.[A-Za-z0-9_.-]+/g),
    ...code.matchAll(/tools\[(["'])([A-Za-z0-9_.-]+)\1\]/g),
  ].map((match) =>
    match[0].startsWith("tools[") ? `tools.${match[2]}` : match[0],
  );
  return (
    addresses.length > 0 &&
    addresses.every((address) =>
      /^tools\.(search|describe)(\.|$)/.test(address),
    )
  );
}

export function executorAddressFromElicitation(input: unknown) {
  const message = findElicitationMessage(input);
  return /Approve\s+(tools\.[^\s?]+)\??/.exec(message)?.[1] ?? null;
}

function findElicitationMessage(input: unknown, depth = 0): string {
  if (!input || !isJsonObject(input) || depth > 4) return "";
  const value = input as Record<string, unknown>;
  if (isJsonString(value.message)) return value.message;
  for (const nested of Object.values(value)) {
    const message = findElicitationMessage(nested, depth + 1);
    if (message) return message;
  }
  return "";
}

export function grantAllowsAddress(
  patterns: readonly string[],
  address: string | null,
) {
  if (!address) return false;
  // Codex normalises MCP server names to identifier-safe underscores in tool
  // calls. Executor's catalog keeps the original hyphenated integration name.
  // They identify the same configured server and must share one approval.
  const requested = canonicalExecutorAddress(address);
  return patterns.some((rawPattern) => {
    const pattern = canonicalExecutorAddress(rawPattern);
    if (pattern === requested) return true;
    if (!pattern.endsWith(".*")) return false;
    return requested.startsWith(pattern.slice(0, -1));
  });
}

export function canonicalExecutorAddress(value: string) {
  return value
    .replace(/^tools\.marketer_local\./, "tools.chief-local.")
    .replace(/^tools\.marketer-local\./, "tools.chief-local.")
    .replace(/^tools\.marketer\./, "tools.chief.")
    .replace(/^tools\.chief_local\./, "tools.chief-local.")
    .replace(
      /^tools\.chief-local\.org\.localWorkspace\./,
      "tools.chief-local.org.localworkspace.",
    );
}
