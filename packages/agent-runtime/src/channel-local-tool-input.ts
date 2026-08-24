import type { ChannelWorkstream } from "@chief/channel-api";
import {
  isJsonNumber,
  isJsonObject,
  isJsonString,
} from "@chief/relay-contracts";

export class ChannelApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export function fail(message: string, status: number, code: string): never {
  throw new ChannelApiFailure(message, status, code);
}

export function textValue(input: unknown, name: string, maximum: number) {
  if (!isJsonString(input) || !input.trim()) {
    fail(`${name} is required.`, 400, "invalid_input");
  }
  return input.trim().slice(0, maximum);
}

export function optionalText(input: unknown, name: string, maximum: number) {
  if (input === undefined) return undefined;
  if (!isJsonString(input)) {
    fail(`${name} must be a string.`, 400, "invalid_input");
  }
  return input.trim().slice(0, maximum);
}

export function expectedVersion(body: Record<string, unknown>) {
  if (body.expectedVersion === undefined) return undefined;
  if (
    !isJsonNumber(body.expectedVersion) ||
    !Number.isInteger(body.expectedVersion) ||
    body.expectedVersion < 1
  ) {
    fail("expectedVersion must be a positive integer.", 400, "invalid_input");
  }
  return body.expectedVersion;
}

export function booleanQuery(url: URL, name: string) {
  return ["1", "true", "yes"].includes(
    url.searchParams.get(name)?.toLowerCase() ?? "",
  );
}

export function workstreamInput(
  input: unknown,
  fallback?: ChannelWorkstream,
): ChannelWorkstream | undefined {
  if (input === undefined) return fallback;
  if (!input || !isJsonObject(input) || Array.isArray(input)) {
    fail("workstream must be an object.", 400, "invalid_input");
  }
  const raw = input as Record<string, unknown>;
  const allowedStatuses = [
    "planned",
    "active",
    "review",
    "complete",
    "cancelled",
  ];
  const status = raw.status ?? fallback?.status ?? "planned";
  if (!isJsonString(status) || !allowedStatuses.includes(status)) {
    fail("workstream.status is invalid.", 400, "invalid_input");
  }
  const pullRequestUrls =
    raw.pullRequestUrls ?? fallback?.pullRequestUrls ?? [];
  if (!Array.isArray(pullRequestUrls) || pullRequestUrls.length > 20) {
    fail(
      "workstream.pullRequestUrls must contain at most 20 URLs.",
      400,
      "invalid_input",
    );
  }
  const urls = pullRequestUrls.map((item) => {
    const url = textValue(item, "workstream.pullRequestUrls", 1_000);
    if (!/^https?:\/\//i.test(url)) {
      fail("Pull request links must use HTTP or HTTPS.", 400, "invalid_input");
    }
    return url;
  });
  return {
    status: status as ChannelWorkstream["status"],
    repository:
      optionalText(raw.repository, "workstream.repository", 500) ??
      fallback?.repository,
    baseBranch:
      optionalText(raw.baseBranch, "workstream.baseBranch", 160) ??
      fallback?.baseBranch,
    branch:
      optionalText(raw.branch, "workstream.branch", 160) ?? fallback?.branch,
    pullRequestUrls: urls,
  };
}

export function validatedAgentIds(
  input: unknown,
  availableAgentIds: readonly string[],
  required: boolean,
) {
  if (input === undefined && !required) return [];
  if (!Array.isArray(input) || (required && input.length === 0)) {
    fail("agentIds must be a non-empty list.", 400, "invalid_input");
  }
  const agentIds = [
    ...new Set(
      input.slice(0, 20).map((item) => textValue(item, "agentIds", 80)),
    ),
  ];
  const unknown = agentIds.filter(
    (agentId) => !availableAgentIds.includes(agentId),
  );
  if (unknown.length > 0) {
    fail(
      `Unknown agents: ${unknown.join(", ")}. List the available agent roster before retrying.`,
      400,
      "unknown_agent",
    );
  }
  return agentIds;
}
