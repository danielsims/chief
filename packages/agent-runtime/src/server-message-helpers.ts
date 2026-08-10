import type {
  AgentEvent,
  ChatExecutionSelection,
  DriverType,
  ExecutorCapability,
  InputRequest,
  MessageAttachment,
} from "./types.js";
import { assertSafeInputRequest } from "./input-values.js";
import { storeGoogleAnalyticsOAuthClient } from "./tools/control-plane.js";
import { writeWorkspaceContextValue } from "./workspace-context.js";
import { workspaceSecrets } from "./workspace-secrets.js";

function chatControlEvents(events: AgentEvent[]) {
  let lastDurableBoundary = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.type === "message" ||
      event?.type === "result" ||
      event?.type === "error" ||
      event?.type === "exit"
    ) {
      lastDurableBoundary = index;
      break;
    }
  }
  return events.filter(
    (event, index) =>
      event.type !== "message" &&
      (event.type !== "stream" || index > lastDurableBoundary),
  );
}

export const SETUP_ATTEMPT_PREFIX = "[chief-integration-setup:";
const MESSAGE_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function safeMessageAttachments(
  attachments: readonly MessageAttachment[] | undefined,
) {
  if (!attachments?.length) return undefined;
  if (attachments.length > 4) throw new Error("Too many attached images.");
  let encodedBytes = 0;
  const safe = attachments.map((attachment) => {
    if (!MESSAGE_IMAGE_TYPES.has(attachment.mediaType)) {
      throw new Error("Unsupported image attachment type.");
    }
    if (
      !attachment.url.startsWith(`data:${attachment.mediaType};base64,`) ||
      attachment.name.length > 240
    ) {
      throw new Error("Invalid image attachment.");
    }
    encodedBytes += attachment.url.length;
    return {
      name: attachment.name || "Image",
      mediaType: attachment.mediaType,
      url: attachment.url,
    };
  });
  if (encodedBytes > 44 * 1024 * 1024) {
    throw new Error("Attached images are too large.");
  }
  return safe;
}

function activeSetupAttempt(events: readonly AgentEvent[]) {
  let attemptId: string | null = null;
  for (const event of events) {
    if (event.type === "message") {
      const text = event.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n");
      if (event.role === "user") {
        const firstLine = text.split("\n", 1)[0] ?? "";
        attemptId =
          firstLine.startsWith(SETUP_ATTEMPT_PREFIX) && firstLine.endsWith("]")
            ? firstLine.slice(SETUP_ATTEMPT_PREFIX.length, -1)
            : attemptId;
      } else if (text.includes("CHIEF_SETUP_RESULT")) {
        attemptId = null;
      }
    }
  }
  return attemptId;
}

const DRIVER_TYPES = new Set<DriverType>([
  "claude",
  "codex",
  "opencode",
  "remote",
]);

function normalizedExecution(
  execution: ChatExecutionSelection | undefined,
): ChatExecutionSelection | undefined {
  if (!execution) return undefined;
  if (!DRIVER_TYPES.has(execution.driver)) {
    throw new Error("Unsupported agent app.");
  }
  const trimmedModel = execution.model?.trim();
  const model = trimmedModel?.length ? trimmedModel : undefined;
  if (model && model.length > 200) throw new Error("Model name is too long.");
  return { driver: execution.driver, model };
}

/**
 * Stores submitted values per each field's save target and returns
 * human-readable destinations for the agent (never the values themselves).
 */
function isGoogleAnalyticsOAuthRequest(request: InputRequest) {
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

async function storeInputValues(
  workspaceId: string,
  request: InputRequest,
  values: Record<string, string>,
  allowWorkspaceContext = false,
  capability?: ExecutorCapability,
): Promise<string[]> {
  assertSafeInputRequest(request, allowWorkspaceContext);
  if (
    request.id === "google-analytics-oauth-client" ||
    request.id.startsWith("google-analytics-oauth-client:") ||
    isGoogleAnalyticsOAuthRequest(request)
  ) {
    const clientId = values.clientId?.trim();
    const clientSecret = values.clientSecret?.trim();
    if (!capability || !clientId || !clientSecret) {
      throw new Error(
        "Google Analytics client ID and client secret are required.",
      );
    }
    await storeGoogleAnalyticsOAuthClientForWorkspace(workspaceId, capability, {
      clientId,
      clientSecret,
    });
    return ["the Google Analytics connection's local credential vault"];
  }
  const saved: string[] = [];
  for (const field of request.fields) {
    const value = values[field.key];
    if (typeof value !== "string" || value.length === 0) continue;
    if ("file" in field.save) {
      saved.push(
        await workspaceSecrets.storeFile(workspaceId, field.save.file, value),
      );
    } else if ("envKey" in field.save) {
      await workspaceSecrets.storeEnv(workspaceId, field.save.envKey, value);
      saved.push(`${field.save.envKey} in this workspace's Keychain vault`);
    } else {
      writeWorkspaceContextValue(workspaceId, field.save.contextKey, value);
      saved.push(`${field.save.contextKey} in this workspace's context`);
    }
  }
  await workspaceSecrets.refresh(workspaceId);
  return saved;
}

async function storeGoogleAnalyticsOAuthClientForWorkspace(
  workspaceId: string,
  capability: ExecutorCapability,
  credentials: { clientId: string; clientSecret: string },
) {
  await storeGoogleAnalyticsOAuthClient(workspaceId, capability, credentials);
  await workspaceSecrets.storeEnv(
    workspaceId,
    "GOOGLE_ANALYTICS_CLIENT_ID",
    credentials.clientId,
  );
  await workspaceSecrets.storeEnv(
    workspaceId,
    "GOOGLE_ANALYTICS_CLIENT_SECRET",
    credentials.clientSecret,
  );
  await workspaceSecrets.refresh(workspaceId);
}

const equivalentInputKeys: Record<string, string[]> = {
  GOOGLE_ANALYTICS_CLIENT_ID: ["CHIEF_GOOGLE_OAUTH_CLIENT_ID"],
  GOOGLE_ANALYTICS_CLIENT_SECRET: ["CHIEF_GOOGLE_OAUTH_CLIENT_SECRET"],
  CHIEF_GOOGLE_OAUTH_CLIENT_ID: ["GOOGLE_ANALYTICS_CLIENT_ID"],
  CHIEF_GOOGLE_OAUTH_CLIENT_SECRET: ["GOOGLE_ANALYTICS_CLIENT_SECRET"],
};

export {
  activeSetupAttempt,
  chatControlEvents,
  equivalentInputKeys,
  isGoogleAnalyticsOAuthRequest,
  normalizedExecution,
  safeMessageAttachments,
  storeGoogleAnalyticsOAuthClientForWorkspace,
  storeInputValues,
};
