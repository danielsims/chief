import { CronExpressionParser } from "cron-parser";

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
    ...new Set(
      [...code.matchAll(/tools\.[A-Za-z0-9_.-]+/g)].map((match) => match[0]),
    ),
  ].filter((address) => !/^tools\.(search|describe)(\.|$)/.test(address));
}

export function executorAddressFromElicitation(input: unknown) {
  const message = findElicitationMessage(input);
  return message.match(/Approve\s+(tools\.[^\s?]+)\??/)?.[1] ?? null;
}

function findElicitationMessage(input: unknown, depth = 0): string {
  if (!input || typeof input !== "object" || depth > 4) return "";
  const value = input as Record<string, unknown>;
  if (typeof value.message === "string") return value.message;
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
  return patterns.some((pattern) => {
    if (pattern === address) return true;
    if (!pattern.endsWith(".*")) return false;
    return address.startsWith(pattern.slice(0, -1));
  });
}
