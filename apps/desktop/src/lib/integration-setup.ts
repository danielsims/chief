// Agentic integration setup: prompt construction for the runtime's setup
// agent, and parsing of the machine-readable lines it emits (verified
// results, structured input requests).

import type {
  ActionItem,
  ChiefUIMessage,
  ContentBlock,
  InputRequest,
} from "@chief/agent-runtime/types";
import {
  GOOGLE_ANALYTICS_DOMAIN,
  googleAnalyticsActionIdFromChat,
  isOnboardingGoogleAnalyticsAction,
} from "@chief/agent-runtime/integration-requests";

export { GOOGLE_ANALYTICS_OAUTH_INPUT_REQUEST } from "@chief/agent-runtime/integration-requests";
export {
  googleAnalyticsActionChatId,
  googleAnalyticsActionIdFromChat,
  isOnboardingGoogleAnalyticsAction,
} from "@chief/agent-runtime/integration-requests";

export const SETUP_RESULT_MARKER = "CHIEF_SETUP_RESULT";

export const INPUT_REQUEST_MARKER = "CHIEF_INPUT_REQUEST";

export const SETUP_ATTEMPT_PREFIX = "[chief-integration-setup:";

/** The runtime confirms stored input with a user-turn starting with this. */
export const INPUT_PROVIDED_PREFIX = "Provided:";
const DIRECT_SETUP_CHAT_PREFIX = "integration-setup-v6-";

export function integrationSetupChatId(workspaceId: string, domain: string) {
  if (!/^[a-z0-9_-]+$/i.test(workspaceId)) {
    throw new Error("Workspace ID is invalid.");
  }
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(domain)) {
    throw new Error("Integration domain is invalid.");
  }
  return `${DIRECT_SETUP_CHAT_PREFIX}${workspaceId}--${domain.toLowerCase()}`;
}

export function integrationSetupDomainFromChat(chatId: string | null) {
  if (!chatId) return null;
  if (googleAnalyticsActionIdFromChat(chatId)) return GOOGLE_ANALYTICS_DOMAIN;
  if (chatId.startsWith(DIRECT_SETUP_CHAT_PREFIX)) {
    const scoped = chatId.slice(DIRECT_SETUP_CHAT_PREFIX.length);
    const separator = scoped.indexOf("--");
    const domain = separator < 0 ? "" : scoped.slice(separator + 2);
    return /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(domain)
      ? domain
      : null;
  }
  return null;
}

export interface SetupResult {
  provider: string;
  status: string;
  displayName?: string;
  externalId?: string;
  propertyId?: string;
  propertyName?: string;
  accountName?: string;
  /** Up to 14 daily points of a headline metric, for the live data preview. */
  series?: { date: string; value: number }[];
  metricLabel?: string;
  [key: string]: unknown;
}

export interface SetupIntegration {
  domain: string;
  name: string;
}

export function integrationSetupChannelPath(
  integration: SetupIntegration,
  attemptId: string = crypto.randomUUID(),
) {
  const params = new URLSearchParams({
    dm: "setup",
    setup: integration.domain,
    prompt: [
      `${SETUP_ATTEMPT_PREFIX}${attemptId}]`,
      `[chief-skill:${setupSkillId(integration.domain)}]`,
      integrationSetupTask(integration),
    ].join("\n\n"),
  });
  return `/conversations?${params.toString()}`;
}

export function isConnectionAction(action: ActionItem) {
  return /\b(connect|connection|integration|source)\b/i.test(
    [action.id, action.sourceId, action.title].filter(Boolean).join(" "),
  );
}

export function isGoogleAnalyticsConnectionAction(action: ActionItem) {
  return (
    isOnboardingGoogleAnalyticsAction(action.id) ||
    action.request?.id === "google-analytics-oauth-client" ||
    (action.request ? isGoogleAnalyticsOAuthRequest(action.request) : false) ||
    (/google analytics/i.test(`${action.title} ${action.reason}`) &&
      isConnectionAction(action))
  );
}

export function isGoogleAnalyticsOAuthRequest(request: InputRequest) {
  const destinations = new Map(
    request.fields.flatMap((field) =>
      "envKey" in field.save ? [[field.key, field.save.envKey] as const] : [],
    ),
  );
  return (
    destinations.get("clientId") === "GOOGLE_ANALYTICS_CLIENT_ID" &&
    destinations.get("clientSecret") === "GOOGLE_ANALYTICS_CLIENT_SECRET"
  );
}

/** Extracts the machine-readable result line from an assistant message, if present. */
export function parseSetupResult(text: string): SetupResult | null {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(SETUP_RESULT_MARKER));
  if (!line) return null;
  try {
    const parsed = JSON.parse(
      line.slice(SETUP_RESULT_MARKER.length).trim(),
    ) as SetupResult;
    return typeof parsed.provider === "string" &&
      typeof parsed.status === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function setupResultMatchesIntegration(
  result: SetupResult,
  domain: string,
): boolean {
  return (
    result.status === "connected" &&
    integrationProviderMatchesDomain(result.provider, domain)
  );
}

/** Matches the runtime's canonical provider id to its setup catalog domain. */
export function integrationProviderMatchesDomain(
  provider: string,
  domain: string,
): boolean {
  return domain === "analytics.googleapis.com"
    ? provider === "google-analytics" || provider === domain
    : provider === domain;
}

/** Returns only the latest setup attempt and results emitted after it. */
export function latestSetupAttempt(messages: ChiefUIMessage[]): {
  id: string;
  result: SetupResult | null;
} | null {
  let attempt: {
    id: string;
    index: number;
    result: SetupResult | null;
  } | null = null;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const firstLine = message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .split("\n", 1)[0];
    const id =
      firstLine?.startsWith(SETUP_ATTEMPT_PREFIX) && firstLine.endsWith("]")
        ? firstLine.slice(SETUP_ATTEMPT_PREFIX.length, -1)
        : undefined;
    if (id) attempt = { id, index, result: null };
  }
  if (!attempt) return null;
  for (const message of messages.slice(attempt.index + 1)) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type !== "text") continue;
      const result = parseSetupResult(part.text);
      if (result) attempt.result = result;
    }
  }
  return { id: attempt.id, result: attempt.result };
}

/** Strips machine-readable marker lines so they never render in chat UI. */
export function stripSetupResult(text: string): string {
  return stripPrivateSetupInstructions(text)
    .split("\n")
    .filter((l) => {
      const trimmed = l.trim();
      return (
        !trimmed.startsWith(SETUP_RESULT_MARKER) &&
        !trimmed.startsWith(INPUT_REQUEST_MARKER)
      );
    })
    .join("\n")
    .trimEnd();
}

/** Defensive cleanup for transcripts created before setup skills were moved
 * out of the recorded user prompt. Private instructions never belong in chat. */
export function stripPrivateSetupInstructions(text: string): string {
  return text
    .replace(
      /<chief_(?:setup_skill|private_instructions)\b[^>]*>[\s\S]*?<\/chief_(?:setup_skill|private_instructions)>/giu,
      "",
    )
    .trim();
}

/** Removes marker lines from text blocks and drops blocks left empty. */
export function withoutMarkerLines(blocks: ContentBlock[]): ContentBlock[] {
  return blocks
    .map((block) =>
      block.type === "text"
        ? { ...block, text: stripSetupResult(block.text) }
        : block,
    )
    .filter((block) => block.type !== "text" || block.text.trim().length > 0);
}

export function parseInputRequest(text: string): InputRequest | null {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(INPUT_REQUEST_MARKER));
  if (!line) return null;
  try {
    const parsed = JSON.parse(
      line.slice(INPUT_REQUEST_MARKER.length).trim(),
    ) as InputRequest;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.title !== "string" ||
      !Array.isArray(parsed.fields) ||
      parsed.fields.some(
        (f) => typeof f.key !== "string" || typeof f.label !== "string",
      )
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The latest unanswered input request in a transcript: a request is pending
 * until a later user turn confirms values were provided (the runtime sends
 * that turn) or it was answered locally this mount.
 */
export function findPendingInputRequest(
  messages: ChiefUIMessage[],
  answered: ReadonlySet<string>,
): InputRequest | null {
  let pending: InputRequest | null = null;
  for (const message of messages) {
    const texts = message.parts.flatMap((part) =>
      part.type === "text" ? [part.text] : [],
    );
    if (message.role === "user") {
      if (texts.some((text) => text.startsWith(INPUT_PROVIDED_PREFIX))) {
        pending = null;
      }
      continue;
    }
    for (const text of texts) {
      const request = parseInputRequest(text);
      if (request && !answered.has(request.id)) pending = request;
    }
  }
  return pending;
}

/**
 * Provider-specific guidance layered onto the generic task when the
 * integration is known to have a preferred local path. Everything else is
 * discovered from the integrations.sh facts at run time.
 */
function setupSkillId(domain: string) {
  if (domain === "github.com") return "setup-github";
  if (domain === "vercel.com") return "setup-vercel";
  if (domain === GOOGLE_ANALYTICS_DOMAIN) return "setup-google-analytics";
  return "setup-integration";
}

export function isGoogleAnalyticsResult(result: SetupResult): boolean {
  return (
    result.provider === "google-analytics" ||
    result.provider === "analytics.googleapis.com"
  );
}

/** Persists a verified connection projection without storing credentials. */
export function persistSetupResult(
  result: SetupResult,
  _deps: {
    markConnected: (args: {
      provider: string;
      category?: string;
      displayName?: string;
      externalId?: string;
    }) => Promise<unknown>;
  },
  _category?: string,
): Promise<void> {
  if (result.status !== "connected") {
    return Promise.reject(
      new Error("Integration setup did not produce a connected result."),
    );
  }
  // The marker drives presentation only. Provider adapters or the verified
  // generic setup tool persist connection state before the marker is emitted.
  return Promise.resolve();
}

export function integrationSetupTask(integration: SetupIntegration): string {
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(integration.domain)) {
    throw new Error("Integration domain is invalid.");
  }
  return `@Setup, connect ${integration.name} for this workspace. Use the attached setup skill, operate the secure browser after I authenticate, save the verified connection, and keep updates brief.`;
}
