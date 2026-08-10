/* eslint-disable max-lines */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import { AgentBrowserSession } from "@chief/browser/node";
import { renderEmailDocument } from "@chief/email/render";
import {
  captureGoogleDesktopOAuthClient,
  googleAccountChooserUrl,
  googleAnalyticsRecipe,
  googleApiLibraryUrl,
  googleAuthUserFromUrl,
  isGoogleAccountChooserUrl,
  redactGoogleOAuthCredentials,
  withGoogleAuthUser,
} from "@chief/google-oauth-connector";

import type { ChannelEvent } from "./channel-types.js";
import type { AgentSession } from "./session.js";
import type {
  AgentDeploymentRecord,
  AgentEvent,
  BrowserAutomationCommand,
  BrowserAutomationResult,
  BrowserPageSnapshot,
  BrowserPresentationMode,
  ChatExecutionSelection,
  ClientMessage,
  DriverType,
  ExecutorCapability,
  InputRequest,
  IntegrationSetupProgress,
  MessageAttachment,
  RuntimeNotice,
  ServerMessage,
} from "./types.js";
import { AgentDeploymentManager } from "./agent-deployments.js";
import { AgentSessionCapabilityRegistry } from "./agent-session-capabilities.js";
import {
  combinedAgentToolPermissionCeiling,
  effectiveAgentToolPermissions,
  permissionForLocalTool,
} from "./agent-tool-permissions.js";
import {
  composeWorkspaceInstructions,
  defaultAgents,
  getAgent,
} from "./agents.js";
import {
  BrowserSessionRegistry,
  commandTargetsActiveBrowserRun,
  integrationBrowserProfile,
  resumableBrowserRuns,
} from "./browser-session-registry.js";
import { browserStateEncryptionKey } from "./browser-state-encryption.js";
import {
  availableCapabilities,
  composeAgentCapabilities,
} from "./capabilities/index.js";
import {
  channelReplyThreadRoot,
  channelRespondingAgentId,
} from "./channel-reply-routing.js";
import { handleGovernanceRequest } from "./channels/governance-bridge.js";
import { createChannelLocalToolContext } from "./channels/local-tool-context.js";
import { channelChatId, GETTING_STARTED_CHANNEL_ID } from "./channels/nip29.js";
import * as channelBridge from "./channels/server-bridge.js";
import {
  loadSlackGatewayConfig,
  readSlackGatewaySettings,
  writeSlackGatewaySettings,
} from "./channels/slack-config.js";
import { SlackGateway } from "./channels/slack-gateway.js";
import {
  isDeploymentNotFound,
  safeRuntimeError,
} from "./deployment-failure.js";
import { captureAndStoreGeneratedCredential } from "./generated-credential-capture.js";
import { googleAnalyticsBrowserProgress } from "./google-browser-progress.js";
import {
  googleOAuthAuthenticatedBrowserPrompt,
  googleOAuthInterruptedBrowserPrompt,
} from "./google-oauth-browser-prompt.js";
import { guardedRequestHandler, localToolRequest } from "./http-runtime.js";
import { hasInputReceipt, inputReceipt } from "./input-receipt.js";
import {
  assertSafeInputRequest,
  verifyContextRequest,
} from "./input-values.js";
import {
  GOOGLE_ANALYTICS_DOMAIN,
  GOOGLE_ANALYTICS_SETUP_TASK,
  googleAnalyticsActionChatId,
  googleAnalyticsOnboardingAttempt,
} from "./integration-requests.js";
import {
  completedSetupResult,
  IntegrationSetupRegistry,
} from "./integration-setup-state.js";
import { handleLocalTool, localToolsOpenApi } from "./local-tools.js";
import { SessionManager } from "./manager.js";
import { createChiefMcpHandler } from "./mcp-server.js";
import { listModels } from "./models.js";
import {
  ONBOARDING_OPENING_MESSAGE,
  onboardingDirectory,
  onboardingKickoffId,
  onboardingKickoffProgress,
  onboardingOpeningIsVisible,
  onboardingRecoveryPrompt,
} from "./onboarding-kickoff.js";
import { authorizeOrganizationRole } from "./organization-authorization.js";
import { ProviderAuthentication } from "./provider-authentication.js";
import { nextRunAt, validateCron } from "./recurring-work.js";
import { resumeDriverBlockedWork } from "./scheduled-agent-config.js";
import { dispatchScheduledWorkEvent } from "./scheduled-work-triggers.js";
import { handleScheduledWorkWebhook } from "./scheduled-work-webhook.js";
import { RecurringWorkScheduler } from "./scheduler.js";
import { setupSkillFromPrompt, setupTaskCatalog } from "./setup-skills.js";
import { executorArtifactsMessage } from "./tools/artifacts.js";
import {
  awaitGoogleAnalyticsAuthorization,
  disconnectGoogleAnalyticsConnection,
  ensureExecutorWorkspace,
  executorHandoffUrl,
  inspectGoogleAnalyticsConfiguration,
  prepareIntegrationSetup,
  registerExecutorAgentPermissionCeiling,
  registerLocalWorkspaceCapability,
  startGoogleAnalyticsAuthorization,
  storeGeneratedCredentialConnection,
  storeGoogleAnalyticsOAuthClient,
  syncExecutorAgentPermissionCeiling,
  verifyGoogleAnalyticsConnection,
} from "./tools/control-plane.js";
import { redactExecutorHandoffCredentials } from "./tools/redaction.js";
import { executorToolServer } from "./tools/spec.js";
import {
  capabilityWhoamiUrl,
  WorkspaceAuthorization,
} from "./workspace-authorization.js";
import {
  readWorkspaceContext,
  writeWorkspaceContext,
  writeWorkspaceContextValue,
} from "./workspace-context.js";
import { workspaceRoot, workspaceSecrets } from "./workspace-secrets.js";

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

const SETUP_ATTEMPT_PREFIX = "[chief-integration-setup:";
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

const PORT = Number(process.env.CHIEF_RUNTIME_PORT ?? 4318);

/**
 * The agent service. Binds loopback-only; clients (desktop app today,
 * Slack/Discord bridges or a phone via tunnel later) speak the same JSON
 * protocol. Designed to run anywhere node runs — laptop, Raspberry Pi.
 */
export function startServer(port = PORT) {
  const localToolCapabilities = new AgentSessionCapabilityRegistry();
  const manager = new SessionManager();
  const localCapabilities = new Map<
    string,
    { apiBaseUrl: string; verifiedAt: number; workspaceId: string }
  >();
  const workspaceCapabilities = new Map<string, ExecutorCapability>();
  const cloudSyncs = new Map<string, Promise<void>>();
  const onboardingBootstraps = new Map<
    string,
    { signature: string; ready: Promise<string>; run: Promise<string> }
  >();
  const integrationSetups = new IntegrationSetupRegistry();
  const pendingGoogleAuthentication = new Map<
    string,
    { attemptId: string; capability: ExecutorCapability }
  >();
  const googleAccountSessions = new Map<
    string,
    {
      authuser?: string;
      awaitingSelection: boolean;
      attemptId?: string;
      capability?: ExecutorCapability;
    }
  >();
  const googleAnalyticsOAuthBrowserPromptOptions = {
    recipe: googleAnalyticsRecipe,
    afterCaptureInstruction:
      "Then continue with googleAnalytics.authorize and the normal consent and verification flow.",
  } as const;
  const inheritedChromeProfile = integrationBrowserProfile(
    process.env.CHIEF_BROWSER_PROFILE,
  );
  const systemChrome = [
    process.env.CHIEF_BROWSER_EXECUTABLE,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find((candidate): candidate is string =>
    Boolean(candidate && existsSync(candidate)),
  );
  const browserEncryptionKey = browserStateEncryptionKey();
  const browsers = new BrowserSessionRegistry((workspaceId, conversationId) => {
    const key = `${workspaceId}\0${conversationId}`;
    const isIntegrationSetup = Boolean(
      integrationSetups.domain(workspaceId, conversationId),
    );
    return new AgentBrowserSession({
      sessionId: `chief-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
      downloadPath: join(
        workspaceRoot(workspaceId),
        ".browser",
        createHash("sha256").update(conversationId).digest("hex").slice(0, 16),
        "downloads",
      ),
      executablePath: systemChrome,
      profile: isIntegrationSetup ? inheritedChromeProfile : undefined,
      restore: true,
      encryptionKey: browserEncryptionKey,
    });
  });
  const browserKey = (workspaceId: string, conversationId: string) =>
    browsers.key(workspaceId, conversationId);
  const browserThreadRoots = new Map<string, string | undefined>();
  const browserParentConversations = new Map<string, string | undefined>();
  const browserAnchorMessages = new Map<string, string>();
  const browserRunIds = new Map<string, string>();
  const browserSession = (workspaceId: string, conversationId: string) =>
    browsers.session(workspaceId, conversationId);
  const activeIntegrationSetup =
    integrationSetups.require.bind(integrationSetups);
  const assertActiveIntegrationSetup =
    integrationSetups.requireDomain.bind(integrationSetups);
  const ensureLocalToolCapability = (workspaceId: string) => {
    const token = localToolCapabilities.workspaceGateway(workspaceId);
    registerLocalWorkspaceCapability(workspaceId, {
      apiBaseUrl: `http://127.0.0.1:${port}`,
      token,
    });
    return token;
  };
  manager.setSessionEnvironmentProvider((identity) => ({
    CHIEF_LOCAL_CAPABILITY: localToolCapabilities.agentSession(identity),
    CHIEF_LOCAL_URL: `http://127.0.0.1:${port}`,
  }));
  const executorPermissionCeiling = async (workspaceId: string) => {
    const preferences = await manager.listAgentPreferences(workspaceId);
    const byAgent = new Map(
      preferences.map((preference) => [preference.agentId, preference]),
    );
    return combinedAgentToolPermissionCeiling(
      defaultAgents
        .filter((agent) => agent.id !== "setup")
        .map((agent) => ({
          agentId: agent.id,
          enabled: byAgent.get(agent.id)?.enabled !== false,
          toolPermissions: byAgent.get(agent.id)?.toolPermissions,
        })),
    );
  };
  const authorizeWorkspace = async (
    workspaceId: string,
    capability: ExecutorCapability,
  ) => {
    const cached = localCapabilities.get(capability.token);
    if (cached) {
      if (cached.workspaceId !== workspaceId) {
        throw new Error("Workspace capability does not match this workspace.");
      }
    }
    const apiBaseUrl = capability.apiBaseUrl || cached?.apiBaseUrl;
    if (!apiBaseUrl) {
      throw new Error("Workspace capability endpoint is required.");
    }
    const url = capabilityWhoamiUrl(apiBaseUrl);
    if (cached && new URL(cached.apiBaseUrl).origin !== url.origin) {
      throw new Error("Workspace capability endpoint changed for this token.");
    }
    if (cached && Date.now() - cached.verifiedAt < 30_000) {
      ensureLocalToolCapability(workspaceId);
      workspaceCapabilities.set(workspaceId, {
        apiBaseUrl: cached.apiBaseUrl,
        token: capability.token,
      });
      registerExecutorAgentPermissionCeiling(
        workspaceId,
        await executorPermissionCeiling(workspaceId),
      );
      return;
    }
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${capability.token}` },
    });
    const body = (await response.json().catch(() => null)) as {
      organizationId?: string;
    } | null;
    if (!response.ok || body?.organizationId !== workspaceId) {
      throw new Error("Could not verify access to this workspace.");
    }
    const verified = {
      apiBaseUrl: url.origin,
      verifiedAt: Date.now(),
      workspaceId,
    };
    localCapabilities.set(capability.token, verified);
    ensureLocalToolCapability(workspaceId);
    workspaceCapabilities.set(workspaceId, {
      apiBaseUrl: verified.apiBaseUrl,
      token: capability.token,
    });
    registerExecutorAgentPermissionCeiling(
      workspaceId,
      await executorPermissionCeiling(workspaceId),
    );
    void ensureSlackGateway(workspaceId);
  };

  // Local Slack gateways: one outbound Socket Mode connection per authorized
  // workspace. Settings changes replace the connection immediately.
  const slackGateways = new Map<string, SlackGateway>();
  const slackErrors = new Map<string, string>();
  const slackStarting = new Map<string, Promise<void>>();
  const slackState = async (workspaceId: string) => {
    const settings = readSlackGatewaySettings(workspaceId) ?? {
      enabled: false,
      driver: "codex" as const,
      allowedUserIds: [],
      allowedChannelIds: [],
    };
    const keys = new Set(await workspaceSecrets.keys(workspaceId));
    return {
      ...settings,
      configured: keys.has("SLACK_BOT_TOKEN") && keys.has("SLACK_APP_TOKEN"),
      connected: slackGateways.has(workspaceId),
      error: slackErrors.get(workspaceId),
    };
  };
  const reloadSlackGateway = async (workspaceId: string) => {
    const existing = slackGateways.get(workspaceId);
    if (existing) await existing.stop().catch(() => undefined);
    slackGateways.delete(workspaceId);
    slackErrors.delete(workspaceId);
    try {
      const config = await loadSlackGatewayConfig(workspaceId);
      if (!config) return;
      if (
        config.allowedUserIds.length === 0 &&
        config.allowedChannelIds.length === 0
      ) {
        throw new Error("Add at least one allowed Slack user or channel ID.");
      }
      const gateway = new SlackGateway(manager, config);
      await gateway.start();
      slackGateways.set(workspaceId, gateway);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      slackErrors.set(workspaceId, message);
      throw error;
    }
  };
  const ensureSlackGateway = async (workspaceId: string) => {
    if (slackGateways.has(workspaceId)) return;
    const active = slackStarting.get(workspaceId);
    if (active) return active;
    const start = reloadSlackGateway(workspaceId)
      .catch((error) =>
        console.error("[slack] gateway failed to start:", error),
      )
      .finally(() => slackStarting.delete(workspaceId));
    slackStarting.set(workspaceId, start);
    return start;
  };

  let broadcastWorkspaceData = (_workspaceId: string) => Promise.resolve();
  let broadcastWorkspaceFiles = (_workspaceId: string) => Promise.resolve();
  let broadcastNotice = (_workspaceId: string, _notice: RuntimeNotice) =>
    undefined;
  let broadcastChannelEvent = (_workspaceId: string, _event: ChannelEvent) =>
    undefined;
  let broadcastChannels = (_workspaceId: string) => Promise.resolve();
  const channelMirrorBindings = new Map<
    string,
    {
      session: AgentSession;
      listener: (event: unknown) => void;
      settleTimer?: ReturnType<typeof setTimeout>;
    }
  >();
  const bindChannelEventMirror = (
    workspaceId: string,
    chatId: string,
    session: AgentSession,
  ) => {
    const key = `${workspaceId}\0${chatId}`;
    const existing = channelMirrorBindings.get(key);
    if (existing?.session === session) return;
    if (existing?.settleTimer) clearTimeout(existing.settleTimer);
    existing?.session.off("event", existing.listener);

    const binding: {
      session: AgentSession;
      listener: (event: unknown) => void;
      settleTimer?: ReturnType<typeof setTimeout>;
    } = {
      session,
      listener: () => undefined,
    };
    // Every user-facing assistant message becomes its own channel event with
    // the same thread tags a user message carries — one mirrorEvent per
    // message, mirroring the exact path users use to post into a channel or a
    // thread. No turn-collapsing state machine: that collapsed several
    // streamed messages into one event and, when the turn's closing message
    // lost its thread context, re-anchored the whole reply into the main
    // timeline.
    const queueMirror = (event: channelBridge.ChannelAssistantMessage) => {
      if (binding.settleTimer) clearTimeout(binding.settleTimer);
      binding.settleTimer = setTimeout(() => {
        binding.settleTimer = undefined;
        if (channelMirrorBindings.get(key) !== binding) return;
        void manager
          .enqueueChatPersistence(workspaceId, chatId, () =>
            channelBridge.mirrorEvent(
              manager,
              () => undefined,
              workspaceId,
              chatId,
              event,
              undefined,
              { id: session.agent.id, name: session.agent.name },
              broadcastChannelEvent,
            ),
          )
          .catch((error: unknown) =>
            console.error("[runtime] background channel event mirror:", error),
          );
      }, 250);
      binding.settleTimer.unref();
    };
    const listener = (rawEvent: unknown) => {
      const event = rawEvent as AgentEvent;
      if (channelBridge.isUserFacingChannelMessage(event)) {
        queueMirror(event);
        return;
      }
      if (event.type === "error") {
        if (binding.settleTimer) clearTimeout(binding.settleTimer);
        binding.settleTimer = undefined;
      }
      if (
        event.type === "exit" &&
        channelMirrorBindings.get(key)?.session === session
      ) {
        if (binding.settleTimer) clearTimeout(binding.settleTimer);
        binding.settleTimer = undefined;
        channelMirrorBindings.delete(key);
      }
    };
    binding.listener = listener;
    session.on("event", listener);
    channelMirrorBindings.set(key, binding);
  };
  let broadcastBrowserNavigate = (
    _workspaceId: string,
    _conversationId: string,
    _url: string,
    _streamUrl: string,
  ) => undefined;
  let broadcastBrowserPrepare = (
    _workspaceId: string,
    _conversationId: string,
    _url: string,
  ) => undefined;
  let broadcastBrowserClosed = (
    _workspaceId: string,
    _conversationId: string,
  ) => undefined;
  let broadcastBrowserActivity = (
    _workspaceId: string,
    _conversationId: string,
    _activity: {
      phase: "started" | "completed";
      label: string;
      cursor?: {
        x: number;
        y: number;
        pressed?: boolean;
        typing?: boolean;
        visible?: boolean;
      };
    },
  ) => undefined;
  let broadcastBrowserPresentation = (
    _workspaceId: string,
    _conversationId: string,
    _mode: BrowserPresentationMode,
  ) => undefined;
  let broadcastIntegrationSetupProgress = (
    _workspaceId: string,
    _conversationId: string,
    _progress: IntegrationSetupProgress,
  ) => undefined;
  const completeBrowserRunPresentation = async (
    workspaceId: string,
    conversationId: string,
  ) => {
    const key = browserKey(workspaceId, conversationId);
    const browserRunId = browserRunIds.get(key);
    if (browserRunId) {
      const session = browserSession(workspaceId, conversationId);
      const [url, title] = await Promise.all([
        session.getUrl().catch(() => undefined),
        session.getTitle().catch(() => undefined),
      ]);
      await manager.store.updateBrowserRun(workspaceId, browserRunId, {
        ...(url ? { url } : {}),
        ...(title ? { title } : {}),
        status: "complete",
      });
      broadcastBrowserClosed(workspaceId, conversationId);
      browserRunIds.delete(key);
    }
    browserThreadRoots.delete(key);
    browserParentConversations.delete(key);
    browserAnchorMessages.delete(key);
  };
  const closeBrowserSession = async (
    workspaceId: string,
    conversationId: string,
  ) => {
    const key = browserKey(workspaceId, conversationId);
    pendingGoogleAuthentication.delete(key);
    providerAuthentication.clear(workspaceId, conversationId);
    googleAccountSessions.delete(key);
    await completeBrowserRunPresentation(workspaceId, conversationId);
    await browsers.close(workspaceId, conversationId);
  };
  const resetBrowserSession = async (
    workspaceId: string,
    conversationId: string,
  ) => {
    const key = browserKey(workspaceId, conversationId);
    pendingGoogleAuthentication.delete(key);
    providerAuthentication.clear(workspaceId, conversationId);
    googleAccountSessions.delete(key);
    await completeBrowserRunPresentation(workspaceId, conversationId);
    await browsers.reset(workspaceId, conversationId);
  };
  const openBrowserSession = async (
    workspaceId: string,
    conversationId: string,
    url: string,
    viewport?: { width: number; height: number },
    threadRootId?: string,
    requestedBrowserRunId?: string,
  ) => {
    const key = browserKey(workspaceId, conversationId);
    const requestedRun = requestedBrowserRunId
      ? await manager.store.browserRun(workspaceId, requestedBrowserRunId)
      : undefined;
    if (
      requestedBrowserRunId &&
      requestedRun?.conversationId !== conversationId
    ) {
      throw new Error(
        "This browsing session does not belong to the conversation.",
      );
    }
    const activeBrowserRunId = browserRunIds.get(key);
    if (
      activeBrowserRunId &&
      requestedBrowserRunId &&
      activeBrowserRunId !== requestedBrowserRunId
    ) {
      await closeBrowserSession(workspaceId, conversationId);
    }
    const conversation = await manager.store.chatRecord(
      workspaceId,
      conversationId,
    );
    browserParentConversations.set(
      key,
      requestedRun?.parentConversationId ?? conversation?.parentId,
    );
    let resolvedThreadRootId = threadRootId ?? requestedRun?.threadRootId;
    // Setup/OAuth-triggered opens don't carry the turn's thread context.
    // Derive it from the live session so the browser is associated with the
    // same thread its opening turn is streaming into.
    resolvedThreadRootId ??= await manager
      .rootChat(workspaceId, conversationId)
      .then((result) => result.session?.activeThreadRootId)
      .catch(() => undefined);
    if (process.env.CHIEF_DEBUG_SESSION_FORCE === "1") {
      console.error(
        `[browser-open] workspace=${workspaceId} conversation=${conversationId} threadRoot=${resolvedThreadRootId ?? "none"} url=${url}`,
      );
    }
    if (resolvedThreadRootId !== undefined) {
      browserThreadRoots.set(key, resolvedThreadRootId);
    }
    // Keep the first insertion point for the session. Re-opening or navigating
    // the same browser must never clear the anchor — that would orphan the
    // viewer and make it vanish from the chat while the agent keeps operating.
    if (requestedRun?.anchorMessageId) {
      browserAnchorMessages.set(key, requestedRun.anchorMessageId);
    }
    let browserRunId = browserRunIds.get(key);
    if (!browserRunId && requestedRun) {
      browserRunId = requestedRun.id;
      browserRunIds.set(key, browserRunId);
      await manager.store.updateBrowserRun(workspaceId, browserRunId, {
        url,
        status: "active",
      });
    }
    if (!browserRunId) {
      browserRunId = randomUUID();
      browserRunIds.set(key, browserRunId);
      const now = Date.now();
      await manager.store.saveBrowserRun({
        id: browserRunId,
        workspaceId,
        conversationId,
        ...(conversation?.parentId
          ? { parentConversationId: conversation.parentId }
          : {}),
        ...(resolvedThreadRootId ? { threadRootId: resolvedThreadRootId } : {}),
        url,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await manager.store.updateBrowserRun(workspaceId, browserRunId, {
        ...(conversation?.parentId
          ? { parentConversationId: conversation.parentId }
          : {}),
        ...(resolvedThreadRootId ? { threadRootId: resolvedThreadRootId } : {}),
        url,
      });
    }
    if (isGoogleAccountChooserUrl(url)) {
      googleAccountSessions.set(key, {
        ...googleAccountSessions.get(key),
        awaitingSelection: true,
      });
    }
    const account = googleAccountSessions.get(key);
    const lockedUrl = account?.authuser
      ? withGoogleAuthUser(url, account.authuser)
      : url;
    if (!viewport) {
      broadcastBrowserPrepare(workspaceId, conversationId, lockedUrl);
    }
    // Keep the remote page at a stable coordinate system and scale it into the
    // chat surface. Resizing Chromium to the rendered card made automation
    // coordinates drift whenever the thread panel changed width.
    const initialViewport = viewport ?? { width: 1280, height: 800 };
    const session = browserSession(workspaceId, conversationId);
    const stream = await session
      .open(lockedUrl, initialViewport)
      .catch((error: unknown) => {
        // A navigation failure is a page-level error, not a browser-session
        // failure. Keep the session alive so the agent can retry with a
        // corrected URL or the user can still see the browser; tearing the
        // session down here makes a bad URL look like the browser never opened.
        throw error;
      });
    const currentUrl = await session.getUrl().catch(() => lockedUrl);
    const title = await session.getTitle().catch(() => "");
    await manager.store.updateBrowserRun(workspaceId, browserRunId, {
      url: currentUrl,
      ...(title ? { title } : {}),
    });
    reportGoogleBrowserStep(workspaceId, conversationId, currentUrl);
    broadcastBrowserNavigate(
      workspaceId,
      conversationId,
      currentUrl,
      stream.url,
    );
    return session;
  };
  const browserRecoveryTasks = new Map<string, Promise<void>>();
  const recoverBrowserRuns = (workspaceId: string) => {
    const current = browserRecoveryTasks.get(workspaceId);
    if (current) return current;
    const task = (async () => {
      const runs = await manager.store.listBrowserRuns(workspaceId);
      const resumable = resumableBrowserRuns(runs);
      const resumableIds = new Set(resumable.map((run) => run.id));
      await Promise.all(
        runs
          .filter((run) => run.status === "active" && !resumableIds.has(run.id))
          .map((run) =>
            manager.store.updateBrowserRun(workspaceId, run.id, {
              status: "complete",
            }),
          ),
      );

      for (const run of resumable) {
        const key = browserKey(workspaceId, run.conversationId);
        if (browserRunIds.has(key)) {
          try {
            const session = browserSession(workspaceId, run.conversationId);
            const stream = await session.stream(5_000);
            const url = await session.getUrl().catch(() => run.url);
            broadcastBrowserNavigate(
              workspaceId,
              run.conversationId,
              url,
              stream.url,
            );
            continue;
          } catch {
            // The UI reconnected but the browser daemon did not. Replace only
            // the process wrapper; encrypted restore state remains available
            // to the bounded recovery loop below.
            await browsers.close(workspaceId, run.conversationId);
          }
        }
        browserRunIds.set(key, run.id);
        if (run.threadRootId !== undefined) {
          browserThreadRoots.set(key, run.threadRootId);
        }
        if (run.parentConversationId !== undefined) {
          browserParentConversations.set(key, run.parentConversationId);
        }
        if (run.anchorMessageId) {
          browserAnchorMessages.set(key, run.anchorMessageId);
        }
        broadcastBrowserPrepare(workspaceId, run.conversationId, run.url);

        let recovered = false;
        let lastError: unknown;
        for (const delay of [0, 300, 1_000, 2_500]) {
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          try {
            const session = browserSession(workspaceId, run.conversationId);
            const stream = await session.open(
              run.url,
              {
                width: 1280,
                height: 800,
              },
              10_000,
            );
            const [url, title] = await Promise.all([
              session.getUrl().catch(() => run.url),
              session.getTitle().catch(() => run.title ?? ""),
            ]);
            await manager.store.updateBrowserRun(workspaceId, run.id, {
              url,
              ...(title ? { title } : {}),
              status: "active",
            });
            broadcastBrowserNavigate(
              workspaceId,
              run.conversationId,
              url,
              stream.url,
            );
            recovered = true;
            break;
          } catch (error) {
            lastError = error;
            await browsers.close(workspaceId, run.conversationId);
          }
        }
        if (recovered) continue;

        console.error(
          `[browser-recovery] could not restore ${run.id}:`,
          lastError instanceof Error ? lastError.message : lastError,
        );
        await manager.store.updateBrowserRun(workspaceId, run.id, {
          status: "complete",
        });
        broadcastBrowserClosed(workspaceId, run.conversationId);
        browserRunIds.delete(key);
        browserThreadRoots.delete(key);
        browserParentConversations.delete(key);
        browserAnchorMessages.delete(key);
      }
    })().finally(() => browserRecoveryTasks.delete(workspaceId));
    browserRecoveryTasks.set(workspaceId, task);
    return task;
  };
  const requestBrowserCommand = async (
    workspaceId: string,
    conversationId: string,
    command: BrowserAutomationCommand,
  ): Promise<BrowserAutomationResult> => {
    const session = browserSession(workspaceId, conversationId);
    const key = browserKey(workspaceId, conversationId);
    const account = googleAccountSessions.get(key);
    if (account?.authuser && !account.awaitingSelection) {
      const currentUrl = await session.getUrl();
      if (isGoogleAccountChooserUrl(currentUrl)) {
        throw new Error(
          "Google account selection was reopened without a human handoff. Open the explicit account chooser through browser.open and pause for the human.",
        );
      }
      const lockedUrl = withGoogleAuthUser(currentUrl, account.authuser);
      if (
        lockedUrl !== currentUrl &&
        googleAuthUserFromUrl(currentUrl) !== account.authuser
      ) {
        await session.open(lockedUrl);
        throw new Error(
          "Chief prevented a Google account switch and restored the human-selected identity. Take a fresh browser snapshot before continuing.",
        );
      }
    }
    const currentBrowserSnapshot = async (): Promise<BrowserPageSnapshot> => {
      const snapshot = await session.snapshot();
      const browserRunId = browserRunIds.get(key);
      if (browserRunId) {
        await manager.store.updateBrowserRun(workspaceId, browserRunId, {
          url: snapshot.url,
          title: snapshot.title,
        });
      }
      const isGoogleSetup =
        integrationSetups
          .domain(workspaceId, conversationId)
          ?.endsWith(".googleapis.com") === true;
      const visibleUrl = redactExecutorHandoffCredentials(
        isGoogleSetup
          ? redactGoogleOAuthCredentials(snapshot.url)
          : snapshot.url,
      );
      const visibleSnapshot = redactExecutorHandoffCredentials(
        isGoogleSetup
          ? redactGoogleOAuthCredentials(snapshot.snapshot)
          : snapshot.snapshot,
      );
      return {
        url: visibleUrl,
        title: snapshot.title,
        text: visibleSnapshot,
        controls: visibleSnapshot
          .split("\n")
          .filter((line) => line.includes("@e"))
          .slice(0, 300),
      };
    };
    if (command.type === "snapshot") {
      return { snapshot: await currentBrowserSnapshot() };
    }
    const preparedInteraction =
      "labels" in command
        ? await session.prepareInteraction(command.labels)
        : undefined;
    const resolvedLabel = preparedInteraction?.label;
    const normalizedLabel = resolvedLabel?.replace(/\s+/g, " ").trim();
    const visibleLabel =
      normalizedLabel && normalizedLabel.length > 64
        ? `${normalizedLabel.slice(0, 63).trimEnd()}…`
        : normalizedLabel;
    const activityLabel =
      command.type === "click"
        ? visibleLabel
          ? `Clicking ${visibleLabel}`
          : "Clicking a page control"
        : command.type === "fill"
          ? visibleLabel
            ? `Filling ${visibleLabel}`
            : "Filling a field"
          : command.type === "select"
            ? visibleLabel
              ? `Selecting ${visibleLabel}`
              : "Selecting an option"
            : `Pressing ${command.key}`;
    const cursor = preparedInteraction?.cursor;
    const cursorState = cursor
      ? { ...cursor, pressed: false, typing: false, visible: true }
      : undefined;
    broadcastBrowserActivity(workspaceId, conversationId, {
      phase: "started",
      label: activityLabel,
      ...(cursorState ? { cursor: cursorState } : {}),
    });
    const completed = () =>
      broadcastBrowserActivity(workspaceId, conversationId, {
        phase: "completed",
        label: activityLabel,
        ...(cursorState ? { cursor: cursorState } : {}),
      });
    const releaseCursor = () => {
      if (!cursorState) return;
      broadcastBrowserActivity(workspaceId, conversationId, {
        phase: "started",
        label: activityLabel,
        cursor: cursorState,
      });
    };
    if (cursorState) {
      // Keep the browser action behind Browser UI's 680ms travel curve so the
      // cursor visibly reaches the target before the page responds.
      await new Promise((resolve) => setTimeout(resolve, 780));
      broadcastBrowserActivity(workspaceId, conversationId, {
        phase: "started",
        label: activityLabel,
        cursor: {
          ...cursorState,
          pressed: true,
          typing: command.type === "fill",
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (command.type === "click") {
      try {
        await session.click(command.labels);
        releaseCursor();
        return {
          clicked: true,
          snapshot: await currentBrowserSnapshot(),
        };
      } finally {
        completed();
      }
    }
    if (command.type === "fill") {
      try {
        await session.fill(command.labels, command.value);
        releaseCursor();
        return {
          filled: true,
          snapshot: await currentBrowserSnapshot(),
        };
      } finally {
        completed();
      }
    }
    if (command.type === "select") {
      try {
        await session.select(command.labels, command.values);
        releaseCursor();
        return {
          selected: true,
          snapshot: await currentBrowserSnapshot(),
        };
      } finally {
        completed();
      }
    }
    try {
      await session.press(command.key);
      return {
        pressed: true,
        snapshot: await currentBrowserSnapshot(),
      };
    } finally {
      completed();
    }
  };
  let broadcastIntegrationVerified = (
    _workspaceId: string,
    _integration: {
      provider: string;
      category: string;
      displayName: string;
      externalId?: string;
    },
  ) => undefined;
  let broadcastAgentDeployment = (_record: AgentDeploymentRecord) => undefined;
  let continueChiefSession = (
    _workspaceId: string,
    _chatId: string,
    _receipt: string,
    _capability: ExecutorCapability,
  ) => Promise.resolve();
  const workspaceRevisions = new Map<string, number>();
  const workspaceSnapshotQueues = new Map<string, Promise<void>>();
  const deployments = new AgentDeploymentManager(manager, (record) =>
    broadcastAgentDeployment(record),
  );
  const persistGoogleAnalyticsConnection = async (
    workspaceId: string,
    property: {
      accountName: string;
      propertyId: string;
      propertyName: string;
    },
  ) => {
    broadcastIntegrationVerified(workspaceId, {
      provider: "google-analytics",
      category: "analytics",
      displayName: property.propertyName,
      externalId: property.propertyId,
    });
    const workspace = await manager.workspaceData(workspaceId);
    const deferredSources = new Set(
      workspace.actionItems.flatMap((action) =>
        action.status === "open" &&
        action.id.startsWith("onboarding-google-analytics-") &&
        !action.request &&
        action.sourceId
          ? [action.sourceId]
          : [],
      ),
    );
    const capability = workspaceCapabilities.get(workspaceId);
    if (capability) {
      await Promise.all(
        [...deferredSources].map((sourceId) =>
          continueChiefSession(
            workspaceId,
            sourceId,
            [
              `Google Analytics is now verified as ${property.propertyName} (${property.propertyId}).`,
              "Setup completed in its separate user-visible conversation. Do not launch or repeat Setup.",
              "Launch the deferred initial Analyst report now. Require it to save the local overview dataset and chart, then incorporate the verified result into the initial business review without delaying completed independent work.",
            ].join("\n"),
            capability,
          ).catch((error: unknown) =>
            console.error(
              "[onboarding] deferred Analyst continuation failed:",
              error,
            ),
          ),
        ),
      );
    }
    await Promise.all(
      workspace.actionItems
        .filter(
          (action) =>
            action.status === "open" &&
            (action.id.startsWith("onboarding-google-analytics-") ||
              action.request?.id === "google-analytics-oauth-client" ||
              (action.request
                ? isGoogleAnalyticsOAuthRequest(action.request)
                : false) ||
              (/google analytics/i.test(action.title) &&
                /connect|connection|integration|source/i.test(action.title))),
        )
        .map((action) => manager.dismissActionItem(workspaceId, action.id)),
    );
    await broadcastWorkspaceData(workspaceId);
  };
  const scheduler = new RecurringWorkScheduler(
    manager,
    (workspaceId) => broadcastWorkspaceData(workspaceId),
    (workspaceId, notice) => broadcastNotice(workspaceId, notice),
    async (workspaceId) => {
      const capability = workspaceCapabilities.get(workspaceId);
      return capability
        ? await ensureExecutorWorkspace(workspaceId, capability)
        : null;
    },
  );
  const syncCloudRecords = async (workspaceId: string) => {
    const active = cloudSyncs.get(workspaceId);
    if (active) return active;
    const sync = (async () => {
      const preference = await manager.agentPreference(workspaceId, "cmo");
      const capability = workspaceCapabilities.get(workspaceId);
      if (preference?.driver !== "remote" || !capability) return;
      const response = await fetch(
        `${capability.apiBaseUrl.replace(/\/$/, "")}/agent-tools/records`,
        { headers: { Authorization: `Bearer ${capability.token}` } },
      );
      if (!response.ok) {
        throw new Error(`Cloud record sync returned ${response.status}.`);
      }
      const records = (await response.json()) as {
        prospects?: {
          id: string;
          name: string;
          company?: string;
          source: string;
          sourceUrl: string;
          summary: string;
          relevance: "high" | "medium" | "low";
          status: "new" | "researching" | "contacted" | "dismissed";
          foundAt: number;
        }[];
        files?: {
          id: string;
          name: string;
          path: string;
          mimeType: string;
          kind: "document" | "email";
          content: string;
          createdBy: "agent" | "user";
          sourceAgentId?: string;
          sourceSessionId?: string;
        }[];
        actions?: {
          id: string;
          agentId: string;
          title: string;
          reason: string;
          sourceId?: string;
          request?: InputRequest;
          status: "open" | "dismissed";
          createdAt: number;
        }[];
      };
      await Promise.all(
        (records.prospects ?? []).map((prospect) =>
          manager.saveProspect(workspaceId, prospect),
        ),
      );
      for (const file of records.files ?? []) {
        const existing = await manager
          .workspaceFile(workspaceId, file.id)
          .catch(() => undefined);
        if (existing?.content === file.content) continue;
        await manager.saveWorkspaceFile(workspaceId, {
          id: file.id,
          name: file.name,
          path: file.path,
          mimeType: file.mimeType,
          kind: file.kind,
          content: file.content,
          createdBy: file.createdBy,
          sourceAgentId: file.sourceAgentId,
          sourceSessionId: file.sourceSessionId,
          expectedVersionId: existing?.currentVersionId,
        });
      }
      await Promise.all(
        (records.actions ?? []).map((action) =>
          manager.raiseActionItem(workspaceId, action),
        ),
      );
    })()
      .catch((error) => console.error("[cloud-sync]", error))
      .finally(() => cloudSyncs.delete(workspaceId));
    cloudSyncs.set(workspaceId, sync);
    return sync;
  };
  const loadWorkspaceDataSnapshot = (workspaceId: string) => {
    const previous =
      workspaceSnapshotQueues.get(workspaceId) ?? Promise.resolve();
    const snapshot = previous
      .catch(() => undefined)
      .then(async () => {
        await syncCloudRecords(workspaceId);
        const data = await manager.workspaceData(workspaceId);
        const revision = (workspaceRevisions.get(workspaceId) ?? 0) + 1;
        workspaceRevisions.set(workspaceId, revision);
        return { data, revision };
      });
    const queued = snapshot.then(
      () => undefined,
      () => undefined,
    );
    workspaceSnapshotQueues.set(workspaceId, queued);
    void queued.finally(() => {
      if (workspaceSnapshotQueues.get(workspaceId) === queued) {
        workspaceSnapshotQueues.delete(workspaceId);
      }
    });
    return snapshot;
  };
  const dismissCloudAction = async (workspaceId: string, id: string) => {
    const preference = await manager.agentPreference(workspaceId, "cmo");
    const capability = workspaceCapabilities.get(workspaceId);
    if (preference?.driver !== "remote" || !capability) return;
    const response = await fetch(
      `${capability.apiBaseUrl.replace(/\/$/, "")}/agent-tools/actions/dismiss`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${capability.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      },
    );
    if (!response.ok) {
      throw new Error(`Cloud action dismissal returned ${response.status}.`);
    }
  };
  const ensureChiefSession = async (
    workspaceId: string,
    chatId: string,
    capability: ExecutorCapability,
  ) => {
    const setupDomain = integrationSetups.domain(workspaceId, chatId);
    // Reuse the live session for this chat regardless of the active setup
    // domain. Switching to a separate setup-agent session here would drop the
    // channel thread anchor the conversation was replying in, so resumed setup
    // work would stream into the main timeline instead of the thread. The setup
    // agent's instructions are the same tool surface; the session identity must
    // not change mid-conversation.
    const current = manager.get(workspaceId, chatId);
    if (current) {
      return current;
    }
    const agent = getAgent(setupDomain ? "setup" : "cmo");
    if (!agent) throw new Error("Chief's agent persona is missing.");
    const preference = await manager.agentPreference(workspaceId, "cmo");
    if (!preference?.driver || preference.enabled === false) {
      throw new Error("Configure the CMO agent app before continuing work.");
    }
    const capableAgent =
      !setupDomain && preference.capabilities
        ? composeAgentCapabilities(
            agent,
            availableCapabilities.filter((item) =>
              preference.capabilities?.includes(item.id),
            ),
          )
        : agent;
    const integratedAgent =
      !setupDomain && preference.integrations !== undefined
        ? {
            ...capableAgent,
            instructions: `${capableAgent.instructions}\n\nAssigned integrations: ${preference.integrations.length > 0 ? preference.integrations.join(", ") : "none"}. Only search for and call integration tools from this assigned set.`,
          }
        : capableAgent;
    const effectiveAgent = {
      ...integratedAgent,
      instructions: composeWorkspaceInstructions(
        integratedAgent.instructions,
        readWorkspaceContext(workspaceId),
      ),
    };
    const executorWorkspace = await ensureExecutorWorkspace(
      workspaceId,
      capability,
    ).catch((error: unknown) => {
      console.error(
        `[runtime] Executor workspace unavailable for ${chatId}:`,
        error,
      );
      return null;
    });
    return manager.ensureRootChat(effectiveAgent, chatId, {
      driver: preference.driver,
      access: "full",
      workspaceId,
      model: preference.model,
      mcpServers: executorWorkspace
        ? [
            executorToolServer(
              executorWorkspace,
              setupDomain ? "browser" : "model",
            ),
          ]
        : [],
      executionOwner: "interactive",
    });
  };
  continueChiefSession = async (workspaceId, chatId, receipt, capability) => {
    const dispatch = async (): Promise<void> => {
      const session = await ensureChiefSession(workspaceId, chatId, capability);
      if (session.isBusy) {
        const resume = (event: AgentEvent) => {
          if (
            event.type !== "result" &&
            event.type !== "error" &&
            event.type !== "exit"
          ) {
            return;
          }
          session.off("event", resume);
          setTimeout(() => {
            void dispatch().catch((error: unknown) =>
              console.error("[action] continuation failed:", error),
            );
          }, 0);
        };
        session.on("event", resume);
        return;
      }
      const releaseExecution = manager.acquireExecution(
        workspaceId,
        chatId,
        "interactive",
      );
      const releaseOnTerminal = (event: AgentEvent) => {
        if (
          event.type === "result" ||
          event.type === "error" ||
          event.type === "exit"
        ) {
          session.off("event", releaseOnTerminal);
          releaseExecution();
        }
      };
      session.on("event", releaseOnTerminal);
      try {
        // Resume in the same channel thread the setup started in. A fresh
        // continuation without the threadRootId would stream its replies into
        // the main timeline while the earlier messages stay in the thread,
        // which looks like duplicates after the turn completes.
        const threadRootId = session.activeThreadRootId;
        await session.sendPrompt(receipt, undefined, true, {
          ...(threadRootId ? { threadRootId } : {}),
        });
      } catch (error) {
        session.off("event", releaseOnTerminal);
        releaseExecution();
        throw error;
      }
    };
    await dispatch();
  };
  const reportGoogleBrowserStep = (
    workspaceId: string,
    sessionId: string,
    rawUrl: string,
  ) => {
    if (
      integrationSetups.domain(workspaceId, sessionId) !==
      GOOGLE_ANALYTICS_DOMAIN
    ) {
      return;
    }
    const progress = googleAnalyticsBrowserProgress(rawUrl);
    if (progress) {
      broadcastIntegrationSetupProgress(workspaceId, sessionId, progress);
    }
  };
  const resumeGoogleAuthentication = async (
    workspaceId: string,
    sessionId: string,
    rawUrl: string,
  ) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return;
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "console.cloud.google.com"
    ) {
      return;
    }
    const key = browserKey(workspaceId, sessionId);
    const pending = pendingGoogleAuthentication.get(key);
    const account = googleAccountSessions.get(key);
    if (!pending && !account?.awaitingSelection) return;
    const authuser = googleAuthUserFromUrl(url.toString());
    if (!authuser) return;
    const capability = pending?.capability ?? account?.capability;
    const attemptId = pending?.attemptId ?? account?.attemptId;
    if (!capability || !attemptId) return;
    pendingGoogleAuthentication.delete(key);
    googleAccountSessions.set(key, {
      authuser,
      awaitingSelection: false,
      attemptId,
      capability,
    });
    const browser = browserSession(workspaceId, sessionId);
    const stream = await browser.stream();
    broadcastBrowserNavigate(
      workspaceId,
      sessionId,
      url.toString(),
      stream.url,
    );
    broadcastIntegrationSetupProgress(workspaceId, sessionId, {
      recipeId: "google-analytics",
      phase: "project",
      instruction:
        "Google sign-in is complete. Chief is taking control of the browser…",
      status: "active",
    });
    await continueChiefSession(
      workspaceId,
      sessionId,
      googleOAuthAuthenticatedBrowserPrompt({
        ...googleAnalyticsOAuthBrowserPromptOptions,
        lockedAuthUser: authuser,
      }),
      capability,
    );
  };
  const providerAuthentication = new ProviderAuthentication({
    browserKey,
    continueSession: continueChiefSession,
    openBrowser: openBrowserSession,
    progress: (...args) => broadcastIntegrationSetupProgress(...args),
  });
  let schedulerReady = false;
  // Bind both loopback families — macOS clients resolving "localhost" may
  // dial ::1 or 127.0.0.1. Never bind non-loopback interfaces here.
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const path = req.url
      ? new URL(req.url, `http://127.0.0.1:${port}`).pathname
      : "/";
    if (req.method === "GET" && path === "/healthz") {
      try {
        await manager.health();
        if (!schedulerReady) throw new Error("Scheduler is not ready.");
        res.writeHead(200, {
          "content-type": "text/plain",
          "cache-control": "no-store",
          "x-chief-runtime": "ready",
          "x-chief-runtime-protocol": "2",
        });
        res.end("chief-runtime-ready");
      } catch {
        res.writeHead(503, { "content-type": "text/plain" });
        res.end("chief-runtime-starting");
      }
      return;
    }
    if (req.method === "GET" && path === "/local-tools/openapi.json") {
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(localToolsOpenApi(`http://127.0.0.1:${port}`)));
      return;
    }
    if (req.method === "POST" && path.startsWith("/hooks/scheduled-runs/")) {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk as Uint8Array);
        size += buffer.length;
        if (size > 256_000) {
          res.writeHead(413, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Webhook payload is too large." }));
          return;
        }
        chunks.push(buffer);
      }
      let body: unknown = {};
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        body = raw ? JSON.parse(raw) : {};
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Webhook payload must be JSON." }));
        return;
      }
      const result = await handleScheduledWorkWebhook({
        path,
        body,
        idempotencyKey:
          typeof req.headers["idempotency-key"] === "string"
            ? req.headers["idempotency-key"]
            : undefined,
        manager,
        runner: scheduler,
      });
      res.writeHead(result.status ?? 404, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(result.value ?? { error: "Not found" }));
      return;
    }
    if (path.startsWith("/local-tools/")) {
      const authorization = req.headers.authorization ?? "";
      const token = /^Bearer (.+)$/.exec(authorization)?.[1];
      const cachedCapability = token
        ? localToolCapabilities.authenticate(token)
        : undefined;
      const workspaceId = cachedCapability?.workspaceId;
      if (!workspaceId || !token) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      const externalCapability = workspaceCapabilities.get(workspaceId);
      if (!externalCapability) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Workspace authorization expired" }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk as Uint8Array));
      }
      // The model cannot be trusted to supply the correct sessionId/attemptId —
      // it repeatedly passes a remembered or invented channel id. Resolve the
      // active setup session for this workspace and inject the authoritative
      // ids into browser/OAuth/setup calls so the runtime always operates on the
      // conversation the user is actually watching.
      const rawBody = Buffer.concat(chunks);
      let body: Record<string, unknown> = {};
      try {
        body = rawBody.length
          ? (JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>)
          : {};
      } catch {
        body = {};
      }
      const requestedSession =
        typeof body.sessionId === "string"
          ? body.sessionId
          : typeof body.conversationId === "string"
            ? body.conversationId
            : (new URL(
                req.url ?? "/",
                `http://127.0.0.1:${port}`,
              ).searchParams.get("sessionId") ?? undefined);
      const credentialSession =
        cachedCapability.kind === "agent-session"
          ? cachedCapability.sessionId
          : undefined;
      const activeCaller = manager.activeAgentSession(
        workspaceId,
        credentialSession,
        cachedCapability.kind === "agent-session",
      );
      if (
        !activeCaller ||
        (cachedCapability.kind === "agent-session" &&
          (activeCaller.chatId !== cachedCapability.sessionId ||
            activeCaller.agentId !== cachedCapability.agentId))
      ) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "This agent session is no longer active.",
            code: "agent_session_inactive",
          }),
        );
        return;
      }
      const requiredPermission = permissionForLocalTool(
        req.method ?? "GET",
        path,
      );
      if (!requiredPermission) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "This local tool has no declared agent permission.",
            code: "agent_tool_permission_unmapped",
          }),
        );
        return;
      }
      const preference = await manager.agentPreference(
        workspaceId,
        activeCaller.agentId,
      );
      const grantedPermissions = effectiveAgentToolPermissions(
        activeCaller.agentId,
        preference?.toolPermissions,
      );
      if (
        preference?.enabled === false ||
        !grantedPermissions.includes(requiredPermission)
      ) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error:
              preference?.enabled === false
                ? "This agent is paused."
                : `This agent does not have ${requiredPermission} permission.`,
            code: "agent_permission_denied",
            permission: requiredPermission,
          }),
        );
        return;
      }
      const activeSetupSession =
        manager
          .activeSessionIds(workspaceId)
          .find((sessionId) => integrationSetups.get(workspaceId, sessionId)) ??
        manager.activeSetupSessionId(workspaceId, requestedSession);
      if (activeSetupSession) {
        const activeSetup = integrationSetups.get(
          workspaceId,
          activeSetupSession,
        );
        body.sessionId = activeSetupSession;
        body.conversationId = activeSetupSession;
        if (activeSetup) body.attemptId = activeSetup.attemptId;
      }
      const request = localToolRequest({
        origin: `http://127.0.0.1:${port}`,
        url: req.url,
        method: req.method,
        headers: req.headers,
        body,
      });
      const response = await handleLocalTool(request, workspaceId, manager, {
        onActivity: () => broadcastWorkspaceData(workspaceId),
        onFilesChanged: () => broadcastWorkspaceFiles(workspaceId),
        channels: await createChannelLocalToolContext({
          manager,
          workspaceId,
          requestedSession: activeCaller.chatId,
          broadcastChannels: () => broadcastChannels(workspaceId),
          broadcastEvent: (event) => broadcastChannelEvent(workspaceId, event),
          broadcastWorkspaceData: () => broadcastWorkspaceData(workspaceId),
          notifyDeletionRequest: (title) =>
            broadcastNotice(workspaceId, { kind: "action", title }),
        }),
        scheduledWork: scheduler,
        openBrowser: async (conversationId, url, fresh) => {
          // The model may pass a stale or wrong conversationId (it sometimes
          // reuses a remembered channel id). Resolve to the live interactive
          // chat so the browser opens in the conversation the user is watching.
          const resolvedConversationId =
            (await manager
              .rootChat(workspaceId, conversationId)
              .then(() => conversationId)
              .catch(() => undefined)) ?? manager.activeChatId(workspaceId);
          const root = await manager.rootChat(
            workspaceId,
            resolvedConversationId ?? conversationId,
          );
          if (fresh) {
            await resetBrowserSession(
              workspaceId,
              resolvedConversationId ?? conversationId,
            );
          } else {
            // A new browser.open call is new conversation content even when it
            // reuses the same authenticated Chromium context. Settle the old
            // transcript block and create a new run at this turn's insertion
            // point without destroying cookies, auth, or the physical browser.
            await completeBrowserRunPresentation(
              workspaceId,
              resolvedConversationId ?? conversationId,
            );
          }
          browserThreadRoots.set(
            browserKey(workspaceId, resolvedConversationId ?? conversationId),
            root.session?.activeThreadRootId,
          );
          await openBrowserSession(
            workspaceId,
            resolvedConversationId ?? conversationId,
            url,
            undefined,
            root.session?.activeThreadRootId,
          );
        },
        closeBrowser: async (conversationId) => {
          await manager.rootChat(workspaceId, conversationId);
          await closeBrowserSession(workspaceId, conversationId);
        },
        presentBrowser: async (conversationId, mode) => {
          await manager.rootChat(workspaceId, conversationId);
          if (!browserRunIds.has(browserKey(workspaceId, conversationId))) {
            throw new Error("There is no active embedded browser to present.");
          }
          broadcastBrowserPresentation(workspaceId, conversationId, mode);
        },
        browserCommand: async (conversationId, command) => {
          await manager.rootChat(workspaceId, conversationId);
          return requestBrowserCommand(workspaceId, conversationId, command);
        },
        activateIntegrationSetup: async (sessionId, attemptId, domain) => {
          const prepared = await prepareIntegrationSetup(
            workspaceId,
            externalCapability,
            domain,
          );
          integrationSetups.assignDomain(workspaceId, sessionId, domain);
          integrationSetups.activate(workspaceId, sessionId, {
            attemptId,
            domain,
            integrationSlug: prepared.integrationSlug,
            recipeId: prepared.recipeId,
          });
          broadcastIntegrationSetupProgress(workspaceId, sessionId, {
            recipeId: prepared.recipeId,
            phase:
              domain === GOOGLE_ANALYTICS_DOMAIN
                ? "authenticated-session"
                : "prepare-connection",
            instruction:
              domain === GOOGLE_ANALYTICS_DOMAIN
                ? "Preparing Google sign-in…"
                : "The provider connection is ready. Opening sign-in…",
            status: "active",
          });
        },
        listSetupTasks: () => {
          return Promise.resolve(
            setupTaskCatalog().map(({ id, domain, label }) => ({
              id,
              domain,
              label,
            })),
          );
        },
        startSetup: async (sessionId, domain) => {
          const task = setupTaskCatalog().find(
            (candidate) =>
              candidate.domain === domain.toLowerCase() ||
              candidate.id === domain.toLowerCase(),
          );
          if (!task) {
            throw new Error(
              `No setup task for "${domain}". Call setup.list to see available integrations.`,
            );
          }
          const prepared = await prepareIntegrationSetup(
            workspaceId,
            externalCapability,
            task.domain,
          );
          const attemptId = `chat:${randomUUID().slice(0, 12)}`;
          integrationSetups.assignDomain(workspaceId, sessionId, task.domain);
          integrationSetups.activate(workspaceId, sessionId, {
            attemptId,
            domain: task.domain,
            integrationSlug: prepared.integrationSlug,
            recipeId: prepared.recipeId,
          });
          broadcastIntegrationSetupProgress(workspaceId, sessionId, {
            recipeId: prepared.recipeId,
            phase:
              task.domain === GOOGLE_ANALYTICS_DOMAIN
                ? "authenticated-session"
                : "prepare-connection",
            instruction: `Setup started: ${task.label}.`,
            status: "active",
          });
          return {
            attemptId,
            domain: task.domain,
            label: task.label,
            instructions: task.instructions,
            available: setupTaskCatalog().map(({ id, domain, label }) => ({
              id,
              domain,
              label,
            })),
          };
        },
        openIntegrationHandoff: async (sessionId, attemptId, url) => {
          activeIntegrationSetup(workspaceId, sessionId, attemptId);
          const handoffUrl = await executorHandoffUrl(workspaceId, url);
          await openBrowserSession(workspaceId, sessionId, handoffUrl);
        },
        openProviderPage: async (sessionId, attemptId, rawTargetUrl) => {
          const setup = activeIntegrationSetup(
            workspaceId,
            sessionId,
            attemptId,
          );
          return providerAuthentication.open({
            workspaceId,
            sessionId,
            attemptId,
            rawTargetUrl,
            capability: {
              apiBaseUrl: externalCapability.apiBaseUrl,
              token: externalCapability.token,
            },
            setup,
          });
        },
        captureGeneratedCredential: async (sessionId, attemptId) => {
          const setup = activeIntegrationSetup(
            workspaceId,
            sessionId,
            attemptId,
          );
          return captureAndStoreGeneratedCredential({
            browser: browserSession(workspaceId, sessionId),
            domain: setup.domain,
            integrationSlug: setup.integrationSlug,
            progress: (phase, instruction) =>
              broadcastIntegrationSetupProgress(workspaceId, sessionId, {
                recipeId: setup.recipeId,
                phase,
                instruction,
                status: "active",
              }),
            store: async (credential, integrationSlug) => {
              const stored = await storeGeneratedCredentialConnection(
                workspaceId,
                externalCapability,
                { domain: setup.domain, integrationSlug, credential },
              );
              const environmentKey =
                setup.domain === "github.com"
                  ? "GITHUB_TOKEN"
                  : setup.domain === "vercel.com"
                    ? "VERCEL_TOKEN"
                    : undefined;
              if (environmentKey) {
                await workspaceSecrets.storeEnv(
                  workspaceId,
                  environmentKey,
                  credential,
                );
                await workspaceSecrets.refresh(workspaceId);
              }
              return stored;
            },
          });
        },
        googleOAuth: {
          provisionClient: async (sessionId, attemptId) => {
            // The model may pass a stale sessionId through the executor's
            // generic `execute` tool. Fall back to the live interactive chat so
            // the browser opens in the conversation the user is watching.
            const resolvedSessionId =
              (integrationSetups.get(workspaceId, sessionId)
                ? sessionId
                : undefined) ??
              manager.activeChatId(workspaceId) ??
              sessionId;
            const setup = activeIntegrationSetup(
              workspaceId,
              resolvedSessionId,
              attemptId,
            );
            if (setup.domain !== "analytics.googleapis.com") {
              throw new Error(
                `Google OAuth client provisioning is not configured for ${setup.domain}.`,
              );
            }
            const existing = await workspaceSecrets.readEnv(workspaceId, [
              "GOOGLE_ANALYTICS_CLIENT_ID",
              "GOOGLE_ANALYTICS_CLIENT_SECRET",
            ]);
            if (
              existing.GOOGLE_ANALYTICS_CLIENT_ID &&
              existing.GOOGLE_ANALYTICS_CLIENT_SECRET
            ) {
              return { status: "configured" as const };
            }
            pendingGoogleAuthentication.set(
              `${workspaceId}\0${resolvedSessionId}`,
              {
                attemptId,
                capability: {
                  apiBaseUrl: externalCapability.apiBaseUrl,
                  token: externalCapability.token,
                },
              },
            );
            broadcastIntegrationSetupProgress(workspaceId, resolvedSessionId, {
              recipeId: "google-analytics",
              phase: "authenticated-session",
              instruction:
                "Sign in with the Google account that administers the Analytics property you want to connect. Chief will take control again automatically.",
              status: "active",
            });
            const firstService = googleAnalyticsRecipe.services[0];
            if (!firstService) throw new Error("Google API recipe is empty.");
            await openBrowserSession(
              workspaceId,
              resolvedSessionId,
              googleAccountChooserUrl(googleApiLibraryUrl(firstService)),
            );
            return {
              status: "authentication-required" as const,
              instruction:
                "The user only needs to complete Google sign-in. Chief will resume this same agent automatically and operate the browser from there.",
            };
          },
          captureClient: async (sessionId, attemptId) => {
            const setup = activeIntegrationSetup(
              workspaceId,
              sessionId,
              attemptId,
            );
            if (setup.domain !== "analytics.googleapis.com") {
              throw new Error(
                `Google OAuth credential storage is not configured for ${setup.domain}.`,
              );
            }
            broadcastIntegrationSetupProgress(workspaceId, sessionId, {
              recipeId: "google-analytics",
              phase: "save-client",
              instruction: "Capturing Google's OAuth client securely…",
              status: "active",
            });
            const client = await captureGoogleDesktopOAuthClient(
              browserSession(workspaceId, sessionId),
            );
            await storeGoogleAnalyticsOAuthClientForWorkspace(
              workspaceId,
              externalCapability,
              { clientId: client.clientId, clientSecret: client.clientSecret },
            );
            broadcastIntegrationSetupProgress(workspaceId, sessionId, {
              recipeId: "google-analytics",
              phase: "authorize",
              instruction:
                "The user-owned OAuth client is stored. Starting Google Analytics authorization…",
              status: "active",
            });
            return { status: "configured" as const };
          },
        },
        googleAnalytics: {
          startAuthorization: async (sessionId, attemptId) => {
            assertActiveIntegrationSetup(
              workspaceId,
              sessionId,
              attemptId,
              "analytics.googleapis.com",
            );
            const legacy = await workspaceSecrets.readEnv(workspaceId, [
              "GOOGLE_ANALYTICS_CLIENT_ID",
              "GOOGLE_ANALYTICS_CLIENT_SECRET",
            ]);
            const clientId = legacy.GOOGLE_ANALYTICS_CLIENT_ID;
            const clientSecret = legacy.GOOGLE_ANALYTICS_CLIENT_SECRET;
            const authorization = await startGoogleAnalyticsAuthorization(
              workspaceId,
              {
                apiBaseUrl: externalCapability.apiBaseUrl,
                token: externalCapability.token,
              },
              clientId && clientSecret ? { clientId, clientSecret } : undefined,
            );
            broadcastIntegrationSetupProgress(workspaceId, sessionId, {
              recipeId: "google-analytics",
              phase: "authorize",
              instruction:
                "One final Google step: sign in again if asked, then approve read-only access to the Analytics account you want Chief to use. Chief will verify the connection automatically.",
              status: "active",
            });
            return authorization;
          },
          completeAuthorization: async (sessionId, attemptId, state) => {
            assertActiveIntegrationSetup(
              workspaceId,
              sessionId,
              attemptId,
              "analytics.googleapis.com",
            );
            broadcastIntegrationSetupProgress(workspaceId, sessionId, {
              recipeId: "google-analytics",
              phase: "verify",
              instruction: "Verifying the Google Analytics connection…",
              status: "active",
            });
            const capability = {
              apiBaseUrl: externalCapability.apiBaseUrl,
              token: externalCapability.token,
            };
            if (state) {
              await awaitGoogleAnalyticsAuthorization(workspaceId, state);
            }
            const verification = await verifyGoogleAnalyticsConnection(
              workspaceId,
              capability,
            );
            if (verification.status === "selection-required") {
              return verification;
            }
            await persistGoogleAnalyticsConnection(
              workspaceId,
              verification.property,
            );
            broadcastIntegrationSetupProgress(workspaceId, sessionId, {
              recipeId: "google-analytics",
              phase: "complete",
              instruction: "Google Analytics is connected.",
              status: "complete",
            });
            integrationSetups.remove(workspaceId, sessionId);
            return {
              status: "connected" as const,
              provider: "google-analytics",
              ...verification.property,
            };
          },
          selectProperty: async (sessionId, attemptId, propertyId) => {
            assertActiveIntegrationSetup(
              workspaceId,
              sessionId,
              attemptId,
              "analytics.googleapis.com",
            );
            broadcastIntegrationSetupProgress(workspaceId, sessionId, {
              recipeId: "google-analytics",
              phase: "verify",
              instruction: "Verifying the selected Analytics property…",
              status: "active",
            });
            const capability = {
              apiBaseUrl: externalCapability.apiBaseUrl,
              token: externalCapability.token,
            };
            const verification = await verifyGoogleAnalyticsConnection(
              workspaceId,
              capability,
              propertyId,
            );
            if (verification.status !== "connected") {
              throw new Error("Select a Google Analytics property.");
            }
            await persistGoogleAnalyticsConnection(
              workspaceId,
              verification.property,
            );
            broadcastIntegrationSetupProgress(workspaceId, sessionId, {
              recipeId: "google-analytics",
              phase: "complete",
              instruction: "Google Analytics is connected.",
              status: "complete",
            });
            integrationSetups.remove(workspaceId, sessionId);
            return {
              status: "connected" as const,
              provider: "google-analytics",
              ...verification.property,
            };
          },
        },
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
      if (req.method === "POST" && response.ok) {
        void broadcastWorkspaceData(workspaceId);
        if (
          path === "/local-tools/files/write" ||
          path === "/local-tools/content"
        ) {
          void broadcastWorkspaceFiles(workspaceId);
        }
        if (path === "/local-tools/action") {
          broadcastNotice(workspaceId, {
            kind: "action",
            title: "An agent flagged something for you",
          });
        }
      }
      return;
    }
    if (await handleMcp(req, res)) return;
    res.writeHead(204, { "access-control-allow-origin": "*" });
    res.end();
  };
  const handleMcp = createChiefMcpHandler({
    manager,
    authorize: authorizeWorkspace,
  });
  const serve = guardedRequestHandler(handler);
  const http4 = createServer(serve);
  const http6 = createServer(serve);
  const wss = new WebSocketServer({ server: http4 });
  const wss6 = new WebSocketServer({ server: http6 });
  const socketAuthorization = new WorkspaceAuthorization<WebSocket>();
  http4.listen(port, "127.0.0.1");
  http6.listen(port, "::1");
  http6.on("error", () => undefined);
  wss6.on("connection", (ws, req) => wss.emit("connection", ws, req));
  wss6.on("error", () => undefined);
  broadcastWorkspaceData = async (workspaceId) => {
    const { data, revision } = await loadWorkspaceDataSnapshot(workspaceId);
    const message = JSON.stringify({
      type: "workspaceData",
      workspaceId,
      revision,
      ...data,
    });
    for (const client of new Set([...wss.clients, ...wss6.clients])) {
      if (
        client.readyState === WebSocket.OPEN &&
        socketAuthorization.canReceive(client, workspaceId)
      ) {
        client.send(message);
      }
    }
  };
  broadcastWorkspaceFiles = async (workspaceId) => {
    await syncCloudRecords(workspaceId);
    const message = JSON.stringify({
      type: "workspaceFiles",
      workspaceId,
      files: await manager.listWorkspaceFiles(workspaceId),
    });
    for (const client of new Set([...wss.clients, ...wss6.clients])) {
      if (
        client.readyState === WebSocket.OPEN &&
        socketAuthorization.canReceive(client, workspaceId)
      ) {
        client.send(message);
      }
    }
  };
  broadcastChannels = async (workspaceId) => {
    const message = JSON.stringify({
      type: "channels",
      workspaceId,
      channels: await manager.store.channelStore().list(workspaceId),
    } satisfies ServerMessage);
    for (const client of new Set([...wss.clients, ...wss6.clients])) {
      if (
        client.readyState === WebSocket.OPEN &&
        socketAuthorization.canReceive(client, workspaceId)
      ) {
        client.send(message);
      }
    }
  };
  broadcastNotice = (workspaceId, notice) => {
    const message = JSON.stringify({
      type: "runtimeNotice",
      workspaceId,
      notice,
    });
    for (const client of new Set([...wss.clients, ...wss6.clients])) {
      if (
        client.readyState === WebSocket.OPEN &&
        socketAuthorization.canReceive(client, workspaceId)
      ) {
        client.send(message);
      }
    }
  };
  broadcastChannelEvent = (workspaceId, event) => {
    const message = JSON.stringify({
      type: "channelEvent",
      workspaceId,
      event,
    } satisfies ServerMessage);
    for (const client of new Set([...wss.clients, ...wss6.clients])) {
      if (
        client.readyState === WebSocket.OPEN &&
        socketAuthorization.canReceive(client, workspaceId)
      ) {
        client.send(message);
      }
    }
    void dispatchScheduledWorkEvent({
      workspaceId,
      event,
      manager,
      runner: scheduler,
    }).catch((error) =>
      console.error("[scheduled-work] channel trigger failed:", error),
    );
  };
  broadcastBrowserNavigate = (workspaceId, conversationId, url, streamUrl) => {
    const key = browserKey(workspaceId, conversationId);
    const browserRunId = browserRunIds.get(key);
    if (!browserRunId) return;
    const threadRootId = browserThreadRoots.get(key);
    const parentConversationId = browserParentConversations.get(key);
    const anchorMessageId = browserAnchorMessages.get(key);
    if (process.env.CHIEF_DEBUG_SESSION_FORCE === "1") {
      console.error(
        `[browser-broadcast] conversation=${conversationId} threadRoot=${threadRootId ?? "none"} anchor=${anchorMessageId ?? "none"} url=${url}`,
      );
    }
    const message = JSON.stringify({
      type: "browserNavigate",
      browserRunId,
      workspaceId,
      conversationId,
      parentConversationId,
      threadRootId,
      anchorMessageId,
      url,
      streamUrl,
    } satisfies ServerMessage);
    for (const client of new Set([...wss.clients, ...wss6.clients])) {
      if (
        client.readyState === WebSocket.OPEN &&
        socketAuthorization.canReceive(client, workspaceId)
      ) {
        client.send(message);
      }
    }
  };
  broadcastBrowserPrepare = (workspaceId, conversationId, url) => {
    const key = browserKey(workspaceId, conversationId);
    const browserRunId = browserRunIds.get(key);
    if (!browserRunId) return;
    const threadRootId = browserThreadRoots.get(key);
    const parentConversationId = browserParentConversations.get(key);
    const anchorMessageId = browserAnchorMessages.get(key);
    const message = JSON.stringify({
      type: "browserPrepare",
      browserRunId,
      workspaceId,
      conversationId,
      parentConversationId,
      threadRootId,
      anchorMessageId,
      url,
    } satisfies ServerMessage);
    for (const client of new Set([...wss.clients, ...wss6.clients])) {
      if (
        client.readyState === WebSocket.OPEN &&
        socketAuthorization.canReceive(client, workspaceId)
      ) {
        client.send(message);
      }
    }
  };
  broadcastBrowserActivity = (workspaceId, conversationId, activity) => {
    const browserRunId = browserRunIds.get(
      browserKey(workspaceId, conversationId),
    );
    if (!browserRunId) return;
    const message = JSON.stringify({
      type: "browserActivity",
      browserRunId,
      workspaceId,
      conversationId,
      ...activity,
    } satisfies ServerMessage);
    for (const client of new Set([...wss.clients, ...wss6.clients])) {
      if (
        client.readyState === WebSocket.OPEN &&
        socketAuthorization.canReceive(client, workspaceId)
      ) {
        client.send(message);
      }
    }
  };
  broadcastBrowserPresentation = (workspaceId, conversationId, mode) => {
    const browserRunId = browserRunIds.get(
      browserKey(workspaceId, conversationId),
    );
    if (!browserRunId) return;
    const message = JSON.stringify({
      type: "browserPresentation",
      browserRunId,
      workspaceId,
      conversationId,
      mode,
    } satisfies ServerMessage);
    for (const client of new Set([...wss.clients, ...wss6.clients])) {
      if (
        client.readyState === WebSocket.OPEN &&
        socketAuthorization.canReceive(client, workspaceId)
      ) {
        client.send(message);
      }
    }
  };
  broadcastBrowserClosed = (workspaceId, conversationId) => {
    const browserRunId = browserRunIds.get(
      browserKey(workspaceId, conversationId),
    );
    if (!browserRunId) return;
    const message = JSON.stringify({
      type: "browserClosed",
      browserRunId,
      workspaceId,
      conversationId,
    } satisfies ServerMessage);
    for (const client of new Set([...wss.clients, ...wss6.clients])) {
      if (
        client.readyState === WebSocket.OPEN &&
        socketAuthorization.canReceive(client, workspaceId)
      ) {
        client.send(message);
      }
    }
  };
  broadcastIntegrationSetupProgress = (
    workspaceId,
    conversationId,
    progress,
  ) => {
    const message = JSON.stringify({
      type: "integrationSetupProgress",
      workspaceId,
      conversationId,
      progress,
    } satisfies ServerMessage);
    for (const client of new Set([...wss.clients, ...wss6.clients])) {
      if (
        client.readyState === WebSocket.OPEN &&
        socketAuthorization.canReceive(client, workspaceId)
      ) {
        client.send(message);
      }
    }
  };
  broadcastAgentDeployment = (record) => {
    const message = JSON.stringify({
      type: "agentDeploymentUpdated",
      workspaceId: record.workspaceId,
      deployment: record,
    });
    for (const client of new Set([...wss.clients, ...wss6.clients])) {
      if (
        client.readyState === WebSocket.OPEN &&
        socketAuthorization.canReceive(client, record.workspaceId)
      ) {
        client.send(message);
      }
    }
  };
  broadcastIntegrationVerified = (workspaceId, integration) => {
    const message = JSON.stringify({
      type: "integrationVerified",
      workspaceId,
      ...integration,
    } satisfies ServerMessage);
    for (const client of new Set([...wss.clients, ...wss6.clients])) {
      if (
        client.readyState === WebSocket.OPEN &&
        socketAuthorization.canReceive(client, workspaceId)
      ) {
        client.send(message);
      }
    }
  };

  wss.on("connection", (ws, req) => {
    console.log(`[chief] client connected (${req.socket.remoteAddress})`);
    ws.on("close", () => console.log("[chief] client disconnected"));
    const send = (msg: ServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };
    socketAuthorization.connect(ws);
    const subscriptions = new Set<string>();
    const chatDestinations = new Map<string, string>();
    const sessionListeners = new Map<
      string,
      {
        session: AgentSession;
        listener: (event: unknown) => void;
      }
    >();
    const bindRootSession = (
      workspaceId: string,
      chatId: string,
      session: AgentSession,
    ) => {
      bindChannelEventMirror(workspaceId, chatId, session);
      const subscriptionKey = `${workspaceId}\0${chatId}`;
      const registered = sessionListeners.get(subscriptionKey);
      if (registered?.session === session) return;
      if (registered) registered.session.off("event", registered.listener);
      if (!subscriptions.has(subscriptionKey)) {
        subscriptions.add(subscriptionKey);
        manager.retain(workspaceId, chatId);
      }
      const handleEvent = async (event: unknown) => {
        const agentEvent = event as AgentEvent;
        // Stream deltas are folded into discrete assistant message events by
        // the session (flushed at `[message:send]` markers and at turn end), so
        // do not forward raw stream deltas to the client. Forwarding them
        // caused the buffered stream placeholder to commit as a duplicate
        // message alongside the flushed messages.
        if (agentEvent.type !== "message" && agentEvent.type !== "stream") {
          send({
            type: "event",
            workspaceId,
            chatId,
            event: agentEvent,
          });
        }
        if (
          agentEvent.type === "message" ||
          agentEvent.type === "result" ||
          agentEvent.type === "error" ||
          agentEvent.type === "permissionResolved"
        ) {
          await manager.waitForChatPersistence(workspaceId, chatId);
          const messages = await manager.messages(workspaceId, chatId);
          const persisted =
            agentEvent.type === "message" && agentEvent.id
              ? messages.find((message) => message.id === agentEvent.id)
              : messages.at(-1);
          if (persisted) {
            send({
              type: "message",
              workspaceId,
              chatId,
              message: persisted,
            });
          }
        }
        if (agentEvent.type === "message" && agentEvent.role === "user") {
          await manager.waitForChatPersistence(workspaceId, chatId);
          send({
            type: "chats",
            workspaceId,
            chats: await manager.listChats(workspaceId),
          });
        }
        if (agentEvent.type === "message" && agentEvent.role === "assistant") {
          const resultProvider = completedSetupResult(
            agentEvent.content
              .flatMap((block) => (block.type === "text" ? [block.text] : []))
              .join("\n"),
          );
          const setup = integrationSetups.get(workspaceId, chatId);
          if (resultProvider && setup) {
            integrationSetups.remove(workspaceId, chatId);
            broadcastIntegrationSetupProgress(workspaceId, chatId, {
              recipeId: setup.recipeId,
              phase: "complete",
              instruction: `${resultProvider} is connected.`,
              status: "complete",
            });
            await closeBrowserSession(workspaceId, chatId);
          }
        }
        if (
          agentEvent.type === "result" ||
          agentEvent.type === "error" ||
          agentEvent.type === "exit"
        ) {
          // A browser run belongs to the conversation, not to one model turn.
          // Ending a turn is often the handoff point where the human takes
          // control for sign-in, consent, passkeys, or MFA. Browser work closes
          // explicitly through browser.close, a verified integration, user
          // dismissal, deletion, or runtime recovery instead.
          await manager.waitForChatPersistence(workspaceId, chatId);
          await broadcastWorkspaceData(workspaceId);
        }
      };
      const listener = (event: unknown) => {
        void handleEvent(event).catch((error: unknown) =>
          console.error("[runtime] root chat event:", error),
        );
      };
      session.on("event", listener);
      sessionListeners.set(subscriptionKey, { session, listener });
    };

    // EventEmitter cannot await socket handlers; errors are handled inside.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    ws.on("message", async (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return send({ type: "error", message: "invalid JSON" });
      }

      try {
        if (
          msg.type === "browserNavigateRequest" ||
          msg.type === "browserReload" ||
          msg.type === "browserClose" ||
          msg.type === "browserViewportResize" ||
          msg.type === "browserUrlChanged"
        ) {
          if (!socketAuthorization.canReceive(ws, msg.workspaceId)) {
            throw new Error("This browser action is not authorized.");
          }
          if (msg.type !== "browserNavigateRequest") {
            const activeRunId = browserRunIds.get(
              browserKey(msg.workspaceId, msg.conversationId),
            );
            // Browser controls are scoped to an immutable run. A delayed close,
            // URL update, reload, or resize from an old component must never
            // mutate the fresh browser that replaced it in the same chat.
            if (!commandTargetsActiveBrowserRun(activeRunId, msg.browserRunId))
              return;
          }
          if (msg.type === "browserClose") {
            await closeBrowserSession(msg.workspaceId, msg.conversationId);
            return;
          }
          if (msg.type === "browserUrlChanged") {
            const url = new URL(msg.url);
            if (url.protocol !== "http:" && url.protocol !== "https:") {
              throw new Error("Browser URLs must use HTTP or HTTPS.");
            }
            const key = browserKey(msg.workspaceId, msg.conversationId);
            const browserRunId = browserRunIds.get(key);
            if (browserRunId) {
              await manager.store.updateBrowserRun(
                msg.workspaceId,
                browserRunId,
                { url: url.toString() },
              );
            }
            const account = googleAccountSessions.get(key);
            if (
              url.hostname === "console.cloud.google.com" &&
              account?.authuser &&
              !account.awaitingSelection
            ) {
              const lockedUrl = withGoogleAuthUser(
                url.toString(),
                account.authuser,
              );
              if (
                lockedUrl !== url.toString() &&
                googleAuthUserFromUrl(url.toString()) !== account.authuser
              ) {
                await openBrowserSession(
                  msg.workspaceId,
                  msg.conversationId,
                  lockedUrl,
                );
                return;
              }
            }
            reportGoogleBrowserStep(
              msg.workspaceId,
              msg.conversationId,
              url.toString(),
            );
            await resumeGoogleAuthentication(
              msg.workspaceId,
              msg.conversationId,
              url.toString(),
            );
            await providerAuthentication.resume(
              msg.workspaceId,
              msg.conversationId,
              url.toString(),
            );
            return;
          }
          await manager.rootChat(msg.workspaceId, msg.conversationId);
          if (msg.type === "browserNavigateRequest") {
            const url = new URL(msg.url);
            if (url.protocol !== "http:" && url.protocol !== "https:") {
              throw new Error("Browser URLs must use HTTP or HTTPS.");
            }
            await openBrowserSession(
              msg.workspaceId,
              msg.conversationId,
              url.toString(),
              { width: msg.width, height: msg.height },
              msg.threadRootId,
              msg.browserRunId,
            );
          } else {
            const browser = browserSession(msg.workspaceId, msg.conversationId);
            if (msg.type === "browserReload") {
              await browser.reload();
              const [url, stream] = await Promise.all([
                browser.getUrl(),
                browser.stream(),
              ]);
              broadcastBrowserNavigate(
                msg.workspaceId,
                msg.conversationId,
                url,
                stream.url,
              );
            } else {
              if (
                !browsers.resolveViewport(msg.workspaceId, msg.conversationId, {
                  width: msg.width,
                  height: msg.height,
                })
              ) {
                await browsers.resize(msg.workspaceId, msg.conversationId, {
                  width: msg.width,
                  height: msg.height,
                });
              }
            }
          }
          return;
        }
        if ("workspaceId" in msg && "executorCapability" in msg) {
          await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
          const previousWorkspace = socketAuthorization.authorize(
            ws,
            msg.workspaceId,
          );
          if (previousWorkspace && previousWorkspace !== msg.workspaceId) {
            for (const subscriptionKey of [...subscriptions]) {
              if (!subscriptionKey.startsWith(`${previousWorkspace}\0`)) {
                continue;
              }
              subscriptions.delete(subscriptionKey);
              const registered = sessionListeners.get(subscriptionKey);
              if (registered) {
                registered.session.off("event", registered.listener);
                sessionListeners.delete(subscriptionKey);
              }
              const chatId = subscriptionKey.slice(
                previousWorkspace.length + 1,
              );
              await manager.release(previousWorkspace, chatId);
            }
          }
        }
        if (msg.type === "updateChannel") {
          try {
            const verified = localCapabilities.get(
              msg.executorCapability.token,
            );
            if (!verified) {
              throw new Error("Could not verify access to this workspace.");
            }
            await authorizeOrganizationRole({
              apiBaseUrl: verified.apiBaseUrl,
              allowedRoles: ["owner", "admin"],
              errorMessage:
                "Only workspace owners and admins can edit channels.",
              sessionToken: msg.sessionToken,
              workspaceId: msg.workspaceId,
            });
            const channel = await manager.store
              .channelStore()
              .update(msg.workspaceId, msg.channelId, {
                name: msg.name,
                topic: msg.topic,
                description: msg.description,
              });
            send({
              type: "channelUpdated",
              requestId: msg.requestId,
              workspaceId: msg.workspaceId,
              channel,
            });
            await channelBridge.sendChannels(manager, msg.workspaceId, send);
          } catch (error) {
            send({
              type: "channelUpdateFailed",
              requestId: msg.requestId,
              workspaceId: msg.workspaceId,
              channelId: msg.channelId,
              message:
                error instanceof Error
                  ? error.message
                  : "Chief could not update this channel.",
            });
          }
          return;
        }
        if (
          await handleGovernanceRequest(msg, {
            manager,
            send,
            capability: (token) => localCapabilities.get(token),
            broadcastChannels,
          })
        )
          return;
        if (msg.type === "deleteChannel") {
          const channelStore = manager.store.channelStore();
          try {
            const verified = localCapabilities.get(
              msg.executorCapability.token,
            );
            if (!verified) {
              throw new Error("Could not verify access to this workspace.");
            }
            await authorizeOrganizationRole({
              apiBaseUrl: verified.apiBaseUrl,
              allowedRoles: ["owner"],
              errorMessage: "Only workspace owners can delete channels.",
              sessionToken: msg.sessionToken,
              workspaceId: msg.workspaceId,
            });
            const channel = await channelStore.assertRemovable(
              msg.workspaceId,
              msg.channelId,
            );
            const chatId = channelChatId(msg.workspaceId, channel.id);
            const chat = await manager.store.chatRecord(
              msg.workspaceId,
              chatId,
            );
            if (chat) {
              await closeBrowserSession(msg.workspaceId, chatId);
              await manager.remove(msg.workspaceId, chatId);
              const subscriptionKey = `${msg.workspaceId}\0${chatId}`;
              subscriptions.delete(subscriptionKey);
              const registered = sessionListeners.get(subscriptionKey);
              if (registered) {
                registered.session.off("event", registered.listener);
                sessionListeners.delete(subscriptionKey);
              }
            }
            await channelStore.remove(msg.workspaceId, channel.id);
            send({
              type: "channelDeleted",
              requestId: msg.requestId,
              workspaceId: msg.workspaceId,
              channelId: channel.id,
            });
            await channelBridge.sendChannels(manager, msg.workspaceId, send);
          } catch (error) {
            send({
              type: "channelDeleteFailed",
              requestId: msg.requestId,
              workspaceId: msg.workspaceId,
              channelId: msg.channelId,
              message:
                error instanceof Error
                  ? error.message
                  : "Chief could not delete this channel.",
            });
          }
          return;
        }
        if (await channelBridge.handleRequest(manager, msg, send)) return;
        switch (msg.type) {
          case "listAgents":
            send({ type: "agents", agents: defaultAgents });
            break;
          case "listModels":
            send({
              type: "models",
              driver: msg.driver,
              models: await listModels(msg.driver),
            });
            break;

          case "listBrowserRuns":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            {
              await recoverBrowserRuns(msg.workspaceId);
              const runs = await manager.store.listBrowserRuns(msg.workspaceId);
              send({
                type: "browserRuns",
                workspaceId: msg.workspaceId,
                runs,
              });
            }
            break;

          case "anchorBrowserRun":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await manager.store.updateBrowserRun(
              msg.workspaceId,
              msg.browserRunId,
              { anchorMessageId: msg.messageId },
            );
            for (const [key, runId] of browserRunIds) {
              if (runId === msg.browserRunId) {
                browserAnchorMessages.set(key, msg.messageId);
                break;
              }
            }
            break;

          case "listWorkspaceData": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            const { data, revision } = await loadWorkspaceDataSnapshot(
              msg.workspaceId,
            );
            send({
              type: "workspaceData",
              workspaceId: msg.workspaceId,
              revision,
              ...data,
            });
            break;
          }

          case "listDiagnostics":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            send({
              type: "diagnostics",
              workspaceId: msg.workspaceId,
              ...(await manager.diagnostics(msg.workspaceId)),
            });
            break;

          case "listWorkspaceFiles":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            send({
              type: "workspaceFiles",
              workspaceId: msg.workspaceId,
              files: await manager.listWorkspaceFiles(msg.workspaceId),
            });
            break;

          case "getWorkspaceFile": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            const file = await manager.workspaceFile(
              msg.workspaceId,
              msg.fileId,
            );
            if (!file) throw new Error("File not found.");
            send({
              type: "workspaceFile",
              workspaceId: msg.workspaceId,
              requestId: msg.requestId,
              file,
            });
            break;
          }

          case "saveWorkspaceFile": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            const file = await manager.saveWorkspaceFile(
              msg.workspaceId,
              msg.file,
            );
            send({
              type: "workspaceFileSaved",
              workspaceId: msg.workspaceId,
              requestId: msg.requestId,
              file,
            });
            await broadcastWorkspaceFiles(msg.workspaceId);
            break;
          }

          case "deleteWorkspaceFile":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await manager.deleteWorkspaceFile(msg.workspaceId, msg.fileId);
            send({
              type: "workspaceFileDeleted",
              workspaceId: msg.workspaceId,
              fileId: msg.fileId,
              requestId: msg.requestId,
            });
            await broadcastWorkspaceFiles(msg.workspaceId);
            break;

          case "renderWorkspaceEmail": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            const file = await manager.workspaceFile(
              msg.workspaceId,
              msg.fileId,
            );
            if (!file) throw new Error("File not found.");
            if (file.kind !== "email") {
              throw new Error("Only email files can be previewed as email.");
            }
            const rendered = await renderEmailDocument({
              title: file.name.replace(/\.md$/i, ""),
              markdown: file.content,
            });
            send({
              type: "workspaceEmailPreview",
              workspaceId: msg.workspaceId,
              fileId: file.id,
              requestId: msg.requestId,
              versionId: file.currentVersionId,
              html: rendered.html,
              text: rendered.text,
            });
            break;
          }

          case "bootstrapOnboardingWork": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            const chatId = channelChatId(
              msg.workspaceId,
              GETTING_STARTED_CHANNEL_ID,
            );
            const signature = JSON.stringify({
              jobs: msg.jobs,
              schedules: msg.schedules,
              workspaceContext: msg.workspaceContext,
              driver: msg.driver,
              model: msg.model,
            });
            const activeBootstrap = onboardingBootstraps.get(msg.workspaceId);
            if (activeBootstrap && activeBootstrap.signature !== signature) {
              throw new Error(
                "Chief is already preparing a different onboarding update. This update was kept for retry.",
              );
            }
            let bootstrap = activeBootstrap;
            if (!bootstrap) {
              let resolveReady!: (chatId: string) => void;
              let rejectReady!: (error: unknown) => void;
              const ready = new Promise<string>((resolve, reject) => {
                resolveReady = resolve;
                rejectReady = reject;
              });
              const preparedRun = (async () => {
                console.log(
                  `[chief] preparing getting-started channel for ${msg.workspaceId}`,
                );
                if (msg.workspaceContext !== undefined) {
                  writeWorkspaceContext(
                    msg.workspaceId,
                    msg.workspaceContext.slice(0, 40_000),
                  );
                }
                const now = Date.now();
                const existingPreference = await manager.agentPreference(
                  msg.workspaceId,
                  "cmo",
                );
                const driver = msg.driver ?? existingPreference?.driver;
                if (!driver) {
                  throw new Error(
                    "Choose a Chief agent app before opening the workspace.",
                  );
                }
                const requestedModel = msg.model?.trim();
                if (requestedModel && requestedModel.length > 200) {
                  throw new Error("Model name is too long.");
                }
                const model =
                  msg.model === null
                    ? undefined
                    : (requestedModel ??
                      (existingPreference?.driver === driver
                        ? existingPreference.model
                        : undefined));
                await manager.saveAgentPreference(msg.workspaceId, {
                  ...existingPreference,
                  agentId: "cmo",
                  enabled: true,
                  driver,
                  model,
                });

                const chiefOnboardingDirectory = onboardingDirectory(
                  workspaceRoot(msg.workspaceId),
                  "cmo",
                );
                mkdirSync(chiefOnboardingDirectory, {
                  recursive: true,
                  mode: 0o700,
                });
                const attachmentPaths: string[][] = [];
                let totalBytes = 0;
                for (const [jobIndex, job] of msg.jobs.entries()) {
                  if (!getAgent(job.agentId)) {
                    throw new Error("Unknown onboarding agent.");
                  }
                  const attachmentDirectory = onboardingDirectory(
                    workspaceRoot(msg.workspaceId),
                    job.agentId,
                  );
                  mkdirSync(attachmentDirectory, {
                    recursive: true,
                    mode: 0o700,
                  });
                  const saved: string[] = [];
                  for (const [attachmentIndex, attachment] of (
                    job.attachments ?? []
                  ).entries()) {
                    const match = /^data:[^;]+;base64,(.+)$/.exec(
                      attachment.dataUrl,
                    );
                    if (!match) {
                      throw new Error("Invalid onboarding attachment.");
                    }
                    const encoded = match[1];
                    if (!encoded) {
                      throw new Error("Invalid onboarding attachment.");
                    }
                    const bytes = Buffer.from(encoded, "base64");
                    totalBytes += bytes.byteLength;
                    if (totalBytes > 6 * 1024 * 1024) {
                      throw new Error("Onboarding attachments exceed 6 MB.");
                    }
                    const safeName = basename(attachment.name).replace(
                      /[^a-zA-Z0-9._-]+/g,
                      "-",
                    );
                    const path = join(
                      attachmentDirectory,
                      `${jobIndex + 1}-${attachmentIndex + 1}-${safeName || "attachment"}`,
                    );
                    writeFileSync(path, bytes, { mode: 0o600 });
                    saved.push(path);
                  }
                  attachmentPaths[jobIndex] = saved;
                }

                const jobs = msg.jobs.map((job) => {
                  const originalIndex = msg.jobs.indexOf(job);
                  const paths = attachmentPaths[originalIndex] ?? [];
                  return [
                    `- ${job.title.trim() || job.id} (${job.agentId}; target ${new Date(job.runAt).toISOString()} ${job.timezone}): ${job.instructions.trim().slice(0, 4_000)}`,
                    ...paths.map((path) => `  Attachment: ${path}`),
                  ].join("\n");
                });
                const schedules = msg.schedules.map(
                  (schedule) =>
                    `- ${schedule.title.trim() || schedule.id}: ${schedule.status}; cron ${schedule.cron} (${schedule.timezone}). ${schedule.instructions.trim().slice(0, 4_000)}`,
                );
                const planPath = join(
                  chiefOnboardingDirectory,
                  "getting-started.md",
                );
                writeFileSync(
                  planPath,
                  [
                    "# Getting started",
                    "",
                    "This is the durable setup plan for the private #getting-started channel.",
                    "Chief should work through it conversationally with the workspace owner and bring Setup into the channel when a provider requires browser authorization or credentials.",
                    "",
                    "## Setup and initial work",
                    jobs.length > 0
                      ? jobs.join("\n")
                      : "- No setup work selected.",
                    "",
                    "## Recurring work",
                    schedules.length > 0
                      ? schedules.join("\n")
                      : "- No recurring work selected.",
                    "",
                  ].join("\n"),
                  { mode: 0o600 },
                );
                const channel = await manager.store
                  .channelStore()
                  .get(msg.workspaceId, GETTING_STARTED_CHANNEL_ID);
                if (!channel) {
                  throw new Error(
                    "Chief could not create the getting-started channel.",
                  );
                }
                await manager.createRootChat(
                  msg.workspaceId,
                  chatId,
                  "Getting started",
                  driver,
                  model,
                );

                for (const schedule of msg.schedules) {
                  if (!/^[a-z0-9][a-z0-9_-]{2,96}$/i.test(schedule.id)) {
                    throw new Error("Invalid onboarding schedule id.");
                  }
                  validateCron(schedule.cron, schedule.timezone);
                  const existing = await manager.recurringWorkById(
                    msg.workspaceId,
                    schedule.id,
                  );
                  if (existing?.conversationId !== undefined) {
                    if (existing.conversationId !== chatId) {
                      throw new Error(
                        "An onboarding schedule belongs to another conversation.",
                      );
                    }
                  }
                  const toolPatterns = Array.from(
                    new Set(
                      schedule.proposedToolPatterns
                        .filter((pattern) => pattern.startsWith("tools."))
                        .slice(0, 24),
                    ),
                  );
                  await manager.saveRecurringWork(msg.workspaceId, {
                    id: schedule.id,
                    conversationId: chatId,
                    agentId: schedule.agentId,
                    title: schedule.title.trim().slice(0, 160),
                    instructions: schedule.instructions.trim().slice(0, 40_000),
                    cron: schedule.cron,
                    timezone: schedule.timezone,
                    status: schedule.status,
                    placement: "local",
                    approvalSummary: schedule.approvalSummary
                      .trim()
                      .slice(0, 2_000),
                    proposedToolPatterns: toolPatterns,
                    grant:
                      schedule.status === "active"
                        ? { version: 1, approvedAt: now, toolPatterns }
                        : undefined,
                    nextAt:
                      schedule.status === "active"
                        ? nextRunAt(schedule.cron, schedule.timezone)
                        : undefined,
                    lastCompletedAt: existing?.lastCompletedAt,
                    lastSummary: existing?.lastSummary,
                    createdAt: existing?.createdAt ?? now,
                    updatedAt: now,
                  });
                }

                const persistedMessages = await manager.transcript(
                  msg.workspaceId,
                  chatId,
                );
                const kickoffId = onboardingKickoffId(chatId);
                const kickoff = onboardingKickoffProgress(
                  persistedMessages,
                  kickoffId,
                );
                if (!kickoff.completed) {
                  const chief = getAgent("cmo");
                  if (!chief) throw new Error("Chief persona is missing.");
                  const capabilities = existingPreference?.capabilities;
                  const capableChief = capabilities
                    ? composeAgentCapabilities(
                        chief,
                        availableCapabilities.filter((capability) =>
                          capabilities.includes(capability.id),
                        ),
                      )
                    : chief;
                  const integratedChief = existingPreference?.integrations
                    ? {
                        ...capableChief,
                        instructions: `${capableChief.instructions}\n\nAssigned integrations: ${existingPreference.integrations.length > 0 ? existingPreference.integrations.join(", ") : "none"}. Only search for and call integration tools from this assigned set.`,
                      }
                    : capableChief;
                  const effectiveChief = channelBridge.agentForChannel(
                    integratedChief,
                    undefined,
                    channel,
                    msg.workspaceContext ??
                      readWorkspaceContext(msg.workspaceId),
                  );
                  const executorWorkspace = await ensureExecutorWorkspace(
                    msg.workspaceId,
                    msg.executorCapability,
                  ).catch((error: unknown) => {
                    console.error(
                      `[runtime] Executor workspace unavailable for ${chatId}:`,
                      error,
                    );
                    return null;
                  });
                  const session = await manager.ensureRootChat(
                    effectiveChief,
                    chatId,
                    {
                      driver,
                      access: "full",
                      workspaceId: msg.workspaceId,
                      model,
                      mcpServers: executorWorkspace
                        ? [executorToolServer(executorWorkspace, "model")]
                        : [],
                      executionOwner: "interactive",
                    },
                  );
                  chatDestinations.set(
                    `${msg.workspaceId}\0${chatId}`,
                    channel.id,
                  );
                  bindRootSession(msg.workspaceId, chatId, session);
                  if (session.isBusy) {
                    resolveReady(chatId);
                    await broadcastWorkspaceData(msg.workspaceId);
                    return chatId;
                  }
                  // A prior onboarding attempt can leave its public-research
                  // browser alive when the agent process is interrupted. The
                  // getting-started chat is intentionally reused for recovery,
                  // but its browser run is not: retaining it also retains the
                  // old message anchor and makes the replay appear inside an
                  // earlier onboarding turn.
                  await closeBrowserSession(msg.workspaceId, chatId);
                  resolveReady(chatId);
                  const sendOnboardingPrompt = async (
                    prompt: string,
                    messageId?: string,
                    record = true,
                  ) => {
                    const releaseExecution = manager.acquireExecution(
                      msg.workspaceId,
                      chatId,
                      "interactive",
                    );
                    const releaseOnTerminal = (event: AgentEvent) => {
                      if (
                        event.type === "result" ||
                        event.type === "error" ||
                        event.type === "exit" ||
                        (event.type === "status" && event.status === "idle")
                      ) {
                        session.off("event", releaseOnTerminal);
                        releaseExecution();
                      }
                    };
                    session.on("event", releaseOnTerminal);
                    try {
                      await session.sendPrompt(prompt, messageId, record);
                      await manager.waitForChatPersistence(
                        msg.workspaceId,
                        chatId,
                      );
                    } catch (error) {
                      session.off("event", releaseOnTerminal);
                      releaseExecution();
                      throw error;
                    }
                  };
                  try {
                    let initialError: unknown;
                    try {
                      const initialPrompt = kickoff.started
                        ? onboardingRecoveryPrompt(
                            driver,
                            !onboardingOpeningIsVisible(
                              persistedMessages,
                              kickoffId,
                            ),
                          )
                        : [
                            `Start by sending this exact text as the first message, followed immediately by [message:send]:\n\n${ONBOARDING_OPENING_MESSAGE}\n\nDo not add another acknowledgement. Continue working in this same turn as soon as that message is sent.`,
                            "Read onboarding/getting-started.md from the current working directory. Launch its independent specialist jobs immediately without waiting for one job before starting another.",
                            "Once the independent specialists are visibly working, send one short, friendly milestone naming who is underway and what you are handling next. End that milestone with [message:send], then keep working.",
                            "Do useful public-source and workspace work immediately. When credentials, consent, or account selection are genuinely required, explain the exact next step in #getting-started and use Setup for the secure browser flow.",
                            "Keep all user-facing progress and the final synthesis in this channel. Do not treat agent activity as a user-facing message.",
                          ].join("\n\n");
                      await sendOnboardingPrompt(
                        initialPrompt,
                        kickoff.started ? undefined : kickoffId,
                        !kickoff.started,
                      );
                    } catch (error) {
                      initialError = error;
                      await manager.waitForChatPersistence(
                        msg.workspaceId,
                        chatId,
                      );
                    }
                    const afterInitialEvents = await manager.transcript(
                      msg.workspaceId,
                      chatId,
                    );
                    const afterInitialAttempt = onboardingKickoffProgress(
                      afterInitialEvents,
                      kickoffId,
                    );
                    if (!afterInitialAttempt.completed) {
                      console.error(
                        `[chief] initial getting-started turn did not complete for ${msg.workspaceId}; recovering once`,
                        initialError,
                      );
                      await sendOnboardingPrompt(
                        onboardingRecoveryPrompt(
                          driver,
                          !onboardingOpeningIsVisible(
                            afterInitialEvents,
                            kickoffId,
                          ),
                        ),
                        undefined,
                        false,
                      );
                    }
                  } finally {
                    // Root onboarding browsing is public research. Secure
                    // sign-in handoffs belong to Setup's separate session, so
                    // it is safe to settle this viewer when the kickoff ends.
                    await closeBrowserSession(msg.workspaceId, chatId);
                  }
                }
                resolveReady(chatId);
                await broadcastWorkspaceData(msg.workspaceId);
                return chatId;
              })();
              const run = preparedRun.catch((error: unknown) => {
                rejectReady(error);
                throw error;
              });
              bootstrap = {
                signature,
                ready,
                run,
              };
              onboardingBootstraps.set(msg.workspaceId, bootstrap);
              void run
                .catch((error: unknown) =>
                  console.error(
                    `[chief] getting-started run failed for ${msg.workspaceId}:`,
                    error,
                  ),
                )
                .finally(() => {
                  if (onboardingBootstraps.get(msg.workspaceId)?.run === run) {
                    onboardingBootstraps.delete(msg.workspaceId);
                  }
                });
            }
            await bootstrap.ready;
            send({
              type: "onboardingWorkBootstrapped",
              workspaceId: msg.workspaceId,
              requestId: msg.requestId,
              chatId,
            });
            send({
              type: "chats",
              workspaceId: msg.workspaceId,
              chats: await manager.listChats(msg.workspaceId),
            });
            console.log(
              `[chief] getting-started channel prepared for ${msg.workspaceId}`,
            );
            break;
          }

          case "saveCampaign":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await manager.saveCampaign(msg.workspaceId, msg.campaign);
            await broadcastWorkspaceData(msg.workspaceId);
            break;

          case "saveRecurringWork": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            validateCron(msg.work.cron, msg.work.timezone);
            const existing = await manager.recurringWorkById(
              msg.workspaceId,
              msg.work.id,
            );
            if (!existing) {
              throw new Error(
                "Recurring work must be proposed by an agent first.",
              );
            }
            if (msg.work.grant) {
              const proposed = new Set(existing.proposedToolPatterns);
              if (
                msg.work.grant.toolPatterns.some(
                  (pattern) => !proposed.has(pattern),
                )
              ) {
                throw new Error(
                  "Approval contains tools the agent did not propose.",
                );
              }
            }
            const active = msg.work.status === "active";
            const now = Date.now();
            const missedOneOff =
              active && existing.onceAt !== undefined && existing.onceAt <= now;
            if (active && !msg.work.grant) {
              throw new Error(
                "Explicit approval is required before activation.",
              );
            }
            // The client may edit scheduling and presentation; instructions
            // and proposed tool patterns stay agent-authored and the grant is
            // validated above, so the delegation can never widen silently.
            await manager.saveRecurringWork(msg.workspaceId, {
              ...existing,
              title: msg.work.title,
              cron: msg.work.cron,
              timezone: msg.work.timezone,
              placement: msg.work.placement,
              skipDates: msg.work.skipDates,
              status: msg.work.status,
              grant: msg.work.grant,
              nextAt: active
                ? missedOneOff
                  ? now
                  : (existing.onceAt ??
                    nextRunAt(msg.work.cron, msg.work.timezone))
                : msg.work.nextAt,
              updatedAt: now,
            });
            if (active) {
              // The app knows approval resolved the action item, so do not
              // make the user dismiss it too.
              for (const suffix of [
                "approval",
                "blocked",
                "failed",
                "required-source",
              ]) {
                await manager.dismissActionItem(
                  msg.workspaceId,
                  `action-${msg.work.id}-${suffix}`,
                );
              }
            }
            await broadcastWorkspaceData(msg.workspaceId);
            if (missedOneOff) {
              void scheduler
                .runNow(msg.workspaceId, msg.work.id)
                .catch((error) => console.error("[recurring-work]", error));
            }
            break;
          }

          case "runRecurringWorkNow":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            void scheduler
              .runNow(msg.workspaceId, msg.recurringWorkId)
              .catch((error) => console.error("[recurring-work]", error));
            break;

          case "dismissActionItem":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await manager.dismissActionItem(msg.workspaceId, msg.actionItemId);
            await dismissCloudAction(msg.workspaceId, msg.actionItemId);
            await broadcastWorkspaceData(msg.workspaceId);
            break;

          case "resolveActionRequest": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            const action = await manager.actionItem(
              msg.workspaceId,
              msg.actionItemId,
            );
            if (
              action?.status !== "open" ||
              action.request?.id !== msg.requestId
            ) {
              throw new Error("This action request is no longer available.");
            }
            const questionKeys = new Set(
              (action.request.questions ?? []).map(
                (question) => question.question,
              ),
            );
            const fieldKeys = new Set(
              action.request.fields.map((field) => field.key),
            );
            if (
              Object.keys(msg.answers).some((key) => !questionKeys.has(key)) ||
              Object.keys(msg.values).some((key) => !fieldKeys.has(key)) ||
              [...questionKeys].some(
                (key) => !(msg.answers[key] ?? "").trim(),
              ) ||
              [...fieldKeys].some((key) => !(msg.values[key] ?? ""))
            ) {
              throw new Error("The submitted action response is incomplete.");
            }
            const directGoogleSetup = isGoogleAnalyticsOAuthRequest(
              action.request,
            );
            const deferredGoogleAnalyticsAttempt =
              googleAnalyticsOnboardingAttempt(action.request.id);
            if (deferredGoogleAnalyticsAttempt && !msg.setup) {
              throw new Error(
                "Open the Google Analytics Setup conversation to continue.",
              );
            }
            let setupSession: AgentSession | undefined;
            if (msg.setup) {
              if (
                !deferredGoogleAnalyticsAttempt ||
                msg.setup.domain !== GOOGLE_ANALYTICS_DOMAIN ||
                msg.setup.chatId !== googleAnalyticsActionChatId(action.id)
              ) {
                throw new Error(
                  "This Setup conversation does not match the action.",
                );
              }
              const setupChat = await manager.rootChat(
                msg.workspaceId,
                msg.setup.chatId,
              );
              if (setupChat.chat.agent !== "setup") {
                throw new Error("This conversation is not owned by Setup.");
              }
              setupSession = manager.get(msg.workspaceId, msg.setup.chatId);
              if (!setupSession || setupSession.isBusy) {
                throw new Error("Wait for the Setup conversation to be ready.");
              }
            }
            const saved = await storeInputValues(
              msg.workspaceId,
              action.request,
              msg.values,
              false,
              msg.executorCapability,
            );
            if (msg.setup && deferredGoogleAnalyticsAttempt && setupSession) {
              const prepared = await prepareIntegrationSetup(
                msg.workspaceId,
                msg.executorCapability,
                GOOGLE_ANALYTICS_DOMAIN,
              );
              integrationSetups.assignDomain(
                msg.workspaceId,
                msg.setup.chatId,
                GOOGLE_ANALYTICS_DOMAIN,
              );
              integrationSetups.activate(msg.workspaceId, msg.setup.chatId, {
                attemptId: deferredGoogleAnalyticsAttempt,
                domain: GOOGLE_ANALYTICS_DOMAIN,
                integrationSlug: prepared.integrationSlug,
                recipeId: prepared.recipeId,
              });
              const updatedAction = {
                ...action,
                title: "Google Analytics setup is running",
                reason:
                  "Complete Google sign-in in the separate Setup conversation. Chief will verify the connection and continue the initial review automatically.",
                request: undefined,
              };
              await manager.raiseActionItem(msg.workspaceId, updatedAction);
              const existingAttempt = activeSetupAttempt(
                await manager.transcript(msg.workspaceId, msg.setup.chatId),
              );
              if (existingAttempt !== deferredGoogleAnalyticsAttempt) {
                const releaseExecution = manager.acquireExecution(
                  msg.workspaceId,
                  msg.setup.chatId,
                  "interactive",
                );
                const releaseOnTerminal = (event: AgentEvent) => {
                  if (
                    event.type === "result" ||
                    event.type === "error" ||
                    event.type === "exit"
                  ) {
                    setupSession.off("event", releaseOnTerminal);
                    releaseExecution();
                  }
                };
                setupSession.on("event", releaseOnTerminal);
                try {
                  await setupSession.sendPrompt(
                    `[chief-integration-setup:${deferredGoogleAnalyticsAttempt}]\nSet up this integration directly. Do not delegate this work to another agent.\n\n${GOOGLE_ANALYTICS_SETUP_TASK}`,
                  );
                } catch (error) {
                  setupSession.off("event", releaseOnTerminal);
                  releaseExecution();
                  await manager.raiseActionItem(msg.workspaceId, action);
                  await broadcastWorkspaceData(msg.workspaceId);
                  throw error;
                }
              }
              send({
                type: "actionRequestResolved",
                workspaceId: msg.workspaceId,
                actionItemId: action.id,
                requestId: msg.requestId,
                action: updatedAction,
              });
              await broadcastWorkspaceData(msg.workspaceId);
              break;
            }
            const receipt = [
              `The user resolved the action: ${action.title}`,
              ...Object.entries(msg.answers).map(
                ([question, answer]) => `- ${question}: ${answer.trim()}`,
              ),
              ...saved.map((destination) => `- Saved input to ${destination}`),
              "Continue the setup or review now using these answers. This is explicit authorization to run the supported local integration setup and open its browser consent flow. Never expose stored credential values, and complete every remaining independent part.",
            ].join("\n");
            const sourceId = action.sourceId;
            if (sourceId && !directGoogleSetup) {
              await continueChiefSession(
                msg.workspaceId,
                sourceId,
                receipt,
                msg.executorCapability,
              );
            }
            await manager.dismissActionItem(msg.workspaceId, action.id);
            await dismissCloudAction(msg.workspaceId, action.id);
            send({
              type: "actionRequestResolved",
              workspaceId: msg.workspaceId,
              actionItemId: action.id,
              requestId: msg.requestId,
            });
            await broadcastWorkspaceData(msg.workspaceId);
            break;
          }

          case "expandRecurringWorkGrant": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            const work = await manager.recurringWorkById(
              msg.workspaceId,
              msg.recurringWorkId,
            );
            if (!work?.grant) {
              throw new Error("Only approved automations can be widened.");
            }
            const blocked = await manager.latestSessionBlockedTools(
              msg.workspaceId,
              msg.recurringWorkId,
            );
            const addTools = [...new Set(msg.addTools)];
            const valid =
              addTools.length > 0 &&
              addTools.every(
                (address) =>
                  /^tools\.[A-Za-z0-9_.-]+$/.test(address) &&
                  blocked.includes(address),
              );
            if (!valid) {
              throw new Error(
                "Only tools a session was actually blocked on can be allowed.",
              );
            }
            await manager.saveRecurringWork(msg.workspaceId, {
              ...work,
              nextAt:
                work.onceAt === undefined
                  ? nextRunAt(work.cron, work.timezone)
                  : msg.rerun
                    ? Date.now()
                    : undefined,
              proposedToolPatterns: [
                ...new Set([...work.proposedToolPatterns, ...addTools]),
              ],
              // The user clicked a button naming these exact addresses —
              // that is the explicit re-approval this widening requires.
              grant: {
                ...work.grant,
                approvedAt: Date.now(),
                toolPatterns: [
                  ...new Set([...work.grant.toolPatterns, ...addTools]),
                ],
              },
              status:
                work.onceAt !== undefined && !msg.rerun ? "paused" : "active",
              updatedAt: Date.now(),
            });
            for (const suffix of [
              "approval",
              "blocked",
              "failed",
              "required-source",
            ]) {
              await manager.dismissActionItem(
                msg.workspaceId,
                `action-${msg.recurringWorkId}-${suffix}`,
              );
            }
            await broadcastWorkspaceData(msg.workspaceId);
            if (msg.rerun) {
              void scheduler
                .runNow(msg.workspaceId, msg.recurringWorkId)
                .catch((error) => console.error("[recurring-work]", error));
            }
            break;
          }

          case "deleteRecurringWork":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await manager.deleteRecurringWork(
              msg.workspaceId,
              msg.recurringWorkId,
            );
            // Rejecting is also an action: clear anything it was flagged for.
            for (const suffix of [
              "approval",
              "blocked",
              "failed",
              "required-source",
            ]) {
              await manager.dismissActionItem(
                msg.workspaceId,
                `action-${msg.recurringWorkId}-${suffix}`,
              );
            }
            await broadcastWorkspaceData(msg.workspaceId);
            break;

          case "listAgentPreferences":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            send({
              type: "agentPreferences",
              workspaceId: msg.workspaceId,
              preferences: await manager.listAgentPreferences(msg.workspaceId),
            });
            break;

          case "saveAgentPreference":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await manager.saveAgentPreference(msg.workspaceId, msg.preference);
            await syncExecutorAgentPermissionCeiling(
              msg.workspaceId,
              await executorPermissionCeiling(msg.workspaceId),
            ).catch((error: unknown) =>
              console.error("[executor] permission sync failed:", error),
            );
            if (msg.preference.driver) {
              await resumeDriverBlockedWork(
                manager,
                msg.workspaceId,
                msg.preference.agentId,
              );
              await broadcastWorkspaceData(msg.workspaceId);
            }
            send({
              type: "agentPreferences",
              workspaceId: msg.workspaceId,
              preferences: await manager.listAgentPreferences(msg.workspaceId),
            });
            break;

          case "listAgentDeployments":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            send({
              type: "agentDeployments",
              workspaceId: msg.workspaceId,
              deployments: deployments.list(msg.workspaceId),
            });
            break;

          case "startAgentDeployment":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            deployments.start({
              workspaceId: msg.workspaceId,
              agentId: msg.agentId,
              target: msg.target,
              projectName: msg.projectName,
              teamId: msg.teamId,
              model: msg.model,
              playbooks: msg.playbooks,
              channels: msg.channels,
              activate: msg.activate,
              controlPlane: {
                apiBaseUrl: msg.executorCapability.apiBaseUrl,
                token: msg.executorCapability.token,
              },
            });
            break;

          case "cancelAgentDeployment":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            deployments.cancel(msg.workspaceId, msg.deploymentId);
            break;

          case "getSlackChannel":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            send({
              type: "slackChannel",
              workspaceId: msg.workspaceId,
              state: await slackState(msg.workspaceId),
            });
            break;

          case "saveSlackChannel": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            const ids = [
              ...msg.settings.allowedUserIds,
              ...msg.settings.allowedChannelIds,
            ];
            if (ids.some((id) => !/^[A-Z0-9]{2,32}$/.test(id))) {
              throw new Error("Slack user and channel IDs are invalid.");
            }
            if (msg.settings.model && msg.settings.model.length > 200) {
              throw new Error("Slack model is too long.");
            }
            const botToken = msg.credentials?.botToken?.trim();
            const appToken = msg.credentials?.appToken?.trim();
            if (botToken) {
              await workspaceSecrets.storeEnv(
                msg.workspaceId,
                "SLACK_BOT_TOKEN",
                botToken,
              );
            }
            if (appToken) {
              await workspaceSecrets.storeEnv(
                msg.workspaceId,
                "SLACK_APP_TOKEN",
                appToken,
              );
            }
            const model = msg.settings.model?.trim();
            writeSlackGatewaySettings(msg.workspaceId, {
              ...msg.settings,
              model: model?.length ? model : undefined,
              allowedUserIds: [...new Set(msg.settings.allowedUserIds)],
              allowedChannelIds: [...new Set(msg.settings.allowedChannelIds)],
            });
            await reloadSlackGateway(msg.workspaceId).catch(() => undefined);
            send({
              type: "slackChannel",
              workspaceId: msg.workspaceId,
              state: await slackState(msg.workspaceId),
            });
            break;
          }
          case "listChats":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            send({
              type: "chats",
              workspaceId: msg.workspaceId,
              chats: await manager.listChats(msg.workspaceId),
            });
            break;
          case "listArtifacts":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            send(await executorArtifactsMessage(msg));
            break;
          case "observeChat": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            const inspected = await manager.inspectChat(
              msg.workspaceId,
              msg.chatId,
            );
            const subscriptionKey = `${msg.workspaceId}\0${msg.chatId}`;
            if (inspected.session && !subscriptions.has(subscriptionKey)) {
              subscriptions.add(subscriptionKey);
              manager.retain(msg.workspaceId, msg.chatId);
              const chatId = msg.chatId;
              const handleEvent = async (event: unknown) => {
                const agentEvent = event as AgentEvent;
                if (agentEvent.type !== "message") {
                  send({
                    type: "event",
                    workspaceId: msg.workspaceId,
                    chatId,
                    event: agentEvent,
                  });
                }
                if (
                  agentEvent.type === "message" ||
                  agentEvent.type === "result" ||
                  agentEvent.type === "error" ||
                  agentEvent.type === "permissionResolved"
                ) {
                  await manager.waitForChatPersistence(msg.workspaceId, chatId);
                  const messages = await manager.messages(
                    msg.workspaceId,
                    chatId,
                  );
                  const persisted =
                    agentEvent.type === "message" && agentEvent.id
                      ? messages.find((message) => message.id === agentEvent.id)
                      : messages.at(-1);
                  if (persisted) {
                    send({
                      type: "message",
                      workspaceId: msg.workspaceId,
                      chatId,
                      message: persisted,
                    });
                  }
                }
              };
              const listener = (event: unknown) => {
                void handleEvent(event).catch((error: unknown) =>
                  console.error("[runtime] observed chat event:", error),
                );
              };
              inspected.session.on("event", listener);
              sessionListeners.set(subscriptionKey, {
                session: inspected.session,
                listener,
              });
            }
            send({
              type: "chatOpened",
              workspaceId: msg.workspaceId,
              chatId: msg.chatId,
              visibility: inspected.chat.visibility,
              parentId: inspected.chat.parentId,
            });
            await manager.waitForChatPersistence(msg.workspaceId, msg.chatId);
            send({
              type: "history",
              workspaceId: msg.workspaceId,
              chatId: msg.chatId,
              messages: await manager.messages(msg.workspaceId, msg.chatId),
              events: chatControlEvents(inspected.events),
              running: inspected.session?.isBusy ?? false,
            });
            break;
          }

          case "openChat": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            const onboardingBootstrap = msg.chatId.startsWith(
              "workspace-kickoff-",
            )
              ? onboardingBootstraps.get(msg.workspaceId)?.ready
              : undefined;
            if (onboardingBootstrap) await onboardingBootstrap;
            await manager.assertInteractiveChat(msg.workspaceId, msg.chatId);
            const agentId =
              msg.purpose === "integration-setup"
                ? "setup"
                : msg.purpose === "analytics-report"
                  ? "analyst"
                  : (msg.agentId ?? "cmo");
            const agent = getAgent(agentId);
            if (!agent) throw new Error(`${agentId} persona is missing.`);
            const preference =
              (await manager.agentPreference(
                msg.workspaceId,
                agentId === "setup" ? "cmo" : agentId,
              )) ??
              (agentId === "analyst"
                ? await manager.agentPreference(msg.workspaceId, "cmo")
                : undefined);
            if (preference?.enabled === false) {
              throw new Error(
                "Configure the CMO agent app before opening chat.",
              );
            }
            const requestedExecution =
              msg.purpose === "integration-setup" && preference?.driver
                ? normalizedExecution({
                    driver: preference.driver,
                    model: preference.model,
                  })
                : normalizedExecution(msg.execution);
            if (
              msg.purpose === "integration-setup" &&
              requestedExecution?.driver === "remote"
            ) {
              throw new Error(
                "Integration setup requires a local agent app so it can reach this Mac's connection service.",
              );
            }
            const preparedSetup =
              msg.purpose === "integration-setup"
                ? await prepareIntegrationSetup(
                    msg.workspaceId,
                    msg.executorCapability,
                    msg.integrationDomain ?? "",
                  )
                : undefined;
            if (msg.purpose === "integration-setup" && !preparedSetup) {
              throw new Error("Integration setup preparation failed.");
            }
            const { channel, storedChat } = await channelBridge.openRootChat(
              manager,
              msg,
              requestedExecution?.driver,
              requestedExecution?.model,
              agentId,
            );
            const destinationId = msg.channelId ?? channel?.id;
            if (destinationId) {
              chatDestinations.set(
                `${msg.workspaceId}\0${msg.chatId}`,
                destinationId,
              );
            }
            let setupAttemptId: string | null = null;
            if (msg.purpose === "integration-setup") {
              integrationSetups.assignDomain(
                msg.workspaceId,
                msg.chatId,
                msg.integrationDomain ?? "",
              );
              setupAttemptId = activeSetupAttempt(
                await manager.transcript(msg.workspaceId, msg.chatId),
              );
              if (setupAttemptId) {
                integrationSetups.activate(msg.workspaceId, msg.chatId, {
                  attemptId: setupAttemptId,
                  domain: msg.integrationDomain ?? "",
                  integrationSlug: preparedSetup?.integrationSlug,
                  recipeId:
                    preparedSetup?.recipeId ?? msg.integrationDomain ?? "",
                });
              } else {
                integrationSetups.remove(msg.workspaceId, msg.chatId);
              }
            }
            if (
              !storedChat ||
              !DRIVER_TYPES.has(storedChat.provider as DriverType)
            ) {
              throw new Error("This chat has an unsupported agent app.");
            }
            const driver =
              requestedExecution?.driver ??
              preference?.driver ??
              (storedChat.provider as DriverType);
            const model = requestedExecution
              ? requestedExecution.model
              : (preference?.model ?? storedChat.model);
            let recoveryPrompt: string | undefined;
            let restartInterruptedSetup = false;
            if (
              msg.purpose === "integration-setup" &&
              msg.integrationDomain === GOOGLE_ANALYTICS_DOMAIN &&
              setupAttemptId &&
              ["running", "waiting", "failed"].includes(storedChat.status)
            ) {
              const visibleUrl = await browserSession(
                msg.workspaceId,
                msg.chatId,
              )
                .getUrl()
                .catch(() => "");
              try {
                const page = new URL(visibleUrl);
                restartInterruptedSetup =
                  page.hostname === "console.cloud.google.com";
              } catch {
                restartInterruptedSetup = false;
              }
              if (restartInterruptedSetup) {
                const authuser = googleAuthUserFromUrl(visibleUrl);
                if (authuser) {
                  googleAccountSessions.set(
                    browserKey(msg.workspaceId, msg.chatId),
                    {
                      authuser,
                      awaitingSelection: false,
                      attemptId: setupAttemptId,
                      capability: msg.executorCapability,
                    },
                  );
                }
                recoveryPrompt = googleOAuthInterruptedBrowserPrompt({
                  ...googleAnalyticsOAuthBrowserPromptOptions,
                  lockedAuthUser: authuser ?? undefined,
                });
              }
            }
            if (msg.chatId.startsWith("workspace-kickoff-")) {
              const events = await manager.transcript(
                msg.workspaceId,
                msg.chatId,
              );
              const kickoffId = onboardingKickoffId(msg.chatId);
              const kickoff = onboardingKickoffProgress(events, kickoffId);
              if (!kickoff.completed) {
                recoveryPrompt = onboardingRecoveryPrompt(
                  driver,
                  !onboardingOpeningIsVisible(events, kickoffId),
                );
                if (!kickoff.started) {
                  await manager.saveTranscript(
                    {
                      id: msg.chatId,
                      organizationId: msg.workspaceId,
                      agentId: "cmo",
                      driver,
                      model,
                    },
                    [
                      {
                        type: "message",
                        id: kickoffId,
                        role: "user",
                        content: [{ type: "text", text: recoveryPrompt }],
                      },
                    ],
                    "Initial business review",
                  );
                }
              }
            }
            const runningSession = manager.get(msg.workspaceId, msg.chatId);
            const session = runningSession?.isBusy
              ? runningSession
              : await (async () => {
                  // Workspace tools are additive: a control-plane failure here
                  // must degrade to no tools, not block chat.
                  const executorWorkspace = await ensureExecutorWorkspace(
                    msg.workspaceId,
                    msg.executorCapability,
                  ).catch((error: unknown) => {
                    console.error(
                      `[runtime] Executor workspace unavailable for ${msg.chatId}:`,
                      error,
                    );
                    return null;
                  });
                  const directPurpose =
                    msg.purpose === "integration-setup" ||
                    msg.purpose === "analytics-report";
                  const capabilities = preference?.capabilities;
                  const capableAgent =
                    !directPurpose && capabilities
                      ? composeAgentCapabilities(
                          agent,
                          availableCapabilities.filter((capability) =>
                            capabilities.includes(capability.id),
                          ),
                        )
                      : agent;
                  const integratedAgent =
                    !directPurpose && preference?.integrations !== undefined
                      ? {
                          ...capableAgent,
                          instructions: `${capableAgent.instructions}\n\nAssigned integrations: ${preference.integrations.length > 0 ? preference.integrations.join(", ") : "none"}. Only search for and call integration tools from this assigned set.`,
                        }
                      : capableAgent;
                  // Prime the session with the workspace's brand context and the
                  // shared operating rules, and persist the context so unattended
                  // recurring sessions open with the same grounding.
                  const workspaceContext =
                    msg.workspaceContext ??
                    readWorkspaceContext(msg.workspaceId);
                  if (msg.workspaceContext) {
                    writeWorkspaceContext(
                      msg.workspaceId,
                      msg.workspaceContext,
                    );
                  }
                  const effectiveAgent = channelBridge.agentForChannel(
                    integratedAgent,
                    msg.purpose,
                    channel,
                    workspaceContext,
                  );
                  const config = {
                    driver,
                    access:
                      recoveryPrompt || msg.purpose === "integration-setup"
                        ? "full"
                        : (msg.access ?? "guarded"),
                    workspaceId: msg.workspaceId,
                    model,
                    mcpServers: executorWorkspace
                      ? [
                          executorToolServer(
                            executorWorkspace,
                            msg.access === "full" &&
                              msg.purpose !== "integration-setup"
                              ? "model"
                              : "browser",
                          ),
                        ]
                      : [],
                    executionOwner: "interactive",
                  } as const;
                  return storedChat.provider !== driver ||
                    storedChat.model !== model
                    ? manager.switchRootChatExecution(
                        effectiveAgent,
                        msg.chatId,
                        config,
                      )
                    : restartInterruptedSetup
                      ? manager.restartRootChatContinuation(
                          effectiveAgent,
                          msg.chatId,
                          config,
                        )
                      : manager.ensureRootChat(
                          effectiveAgent,
                          msg.chatId,
                          config,
                        );
                })();
            bindRootSession(msg.workspaceId, msg.chatId, session);
            send({
              type: "chatOpened",
              workspaceId: msg.workspaceId,
              chatId: msg.chatId,
              visibility: "user",
              execution: { driver, model },
            });
            await manager.waitForChatPersistence(msg.workspaceId, msg.chatId);
            // Replay the buffered transcript so navigating away and back (or
            // reconnecting mid-run) resumes instead of presenting a fresh chat.
            send({
              type: "history",
              workspaceId: msg.workspaceId,
              chatId: msg.chatId,
              messages: await manager.messages(msg.workspaceId, msg.chatId),
              events: chatControlEvents(session.events),
              running: session.isBusy,
            });
            if (recoveryPrompt && !session.isBusy) {
              const releaseExecution = manager.acquireExecution(
                msg.workspaceId,
                msg.chatId,
                "interactive",
              );
              const releaseOnTerminal = (event: AgentEvent) => {
                if (
                  event.type === "result" ||
                  event.type === "error" ||
                  event.type === "exit" ||
                  (event.type === "status" && event.status === "idle")
                ) {
                  session.off("event", releaseOnTerminal);
                  releaseExecution();
                }
              };
              session.on("event", releaseOnTerminal);
              try {
                await session.sendPrompt(recoveryPrompt, undefined, false);
              } catch (error) {
                session.off("event", releaseOnTerminal);
                releaseExecution();
                throw error;
              }
            }
            break;
          }

          case "closeChat": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            const subscriptionKey = `${msg.workspaceId}\0${msg.chatId}`;
            if (subscriptions.delete(subscriptionKey)) {
              const registered = sessionListeners.get(subscriptionKey);
              if (registered) {
                registered.session.off("event", registered.listener);
                sessionListeners.delete(subscriptionKey);
              }
              await manager.release(msg.workspaceId, msg.chatId);
            }
            break;
          }

          case "deleteChat":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await manager.assertInteractiveChat(msg.workspaceId, msg.chatId);
            await manager.rootChat(msg.workspaceId, msg.chatId);
            {
              const subscriptionKey = `${msg.workspaceId}\0${msg.chatId}`;
              subscriptions.delete(subscriptionKey);
              const registered = sessionListeners.get(subscriptionKey);
              if (registered) {
                registered.session.off("event", registered.listener);
                sessionListeners.delete(subscriptionKey);
              }
            }
            await manager.remove(msg.workspaceId, msg.chatId);
            send({
              type: "chats",
              workspaceId: msg.workspaceId,
              chats: await manager.listChats(msg.workspaceId),
            });
            break;

          case "sendMessage": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await manager.assertInteractiveChat(msg.workspaceId, msg.chatId);
            const attachments = safeMessageAttachments(msg.attachments);
            const destinationId = chatDestinations.get(
              `${msg.workspaceId}\0${msg.chatId}`,
            );
            const destinationChannel = destinationId
              ? await manager.store
                  .channelStore()
                  .get(msg.workspaceId, destinationId)
              : undefined;
            const newAgentIds = (msg.mentions ?? []).filter(
              (agentId) => !destinationChannel?.agentIds.includes(agentId),
            );
            if (destinationChannel && newAgentIds.length > 0) {
              await manager.store
                .channelStore()
                .addAgents(msg.workspaceId, destinationChannel.id, newAgentIds);
              send({
                type: "channels",
                workspaceId: msg.workspaceId,
                channels: await manager.store
                  .channelStore()
                  .list(msg.workspaceId),
              });
            }
            let openedSession = (
              await manager.rootChat(msg.workspaceId, msg.chatId)
            ).session;
            if (!openedSession) {
              // A chat record can outlive its in-memory session (runtime
              // restart, or the chat was closed and released while its tab
              // stayed open). Restore it instead of asking the user to reopen
              // the chat: the stored transcript + provider state are enough to
              // rebuild the session and resume the conversation.
              const restored = await ensureChiefSession(
                msg.workspaceId,
                msg.chatId,
                msg.executorCapability,
              ).catch(() => undefined);
              if (!restored) {
                return send({
                  type: "error",
                  message:
                    "No session for this chat yet. Reopen it to reconnect.",
                  chatId: msg.chatId,
                });
              }
              openedSession = restored;
              bindRootSession(msg.workspaceId, msg.chatId, restored);
              send({
                type: "chatOpened",
                workspaceId: msg.workspaceId,
                chatId: msg.chatId,
                visibility: "user",
                execution: {
                  driver: restored.config.driver,
                  model: restored.config.model,
                },
              });
            }
            if (newAgentIds.length > 0) {
              const senderName = msg.senderName?.trim();
              const actorName = senderName?.length ? senderName : "You";
              const names = newAgentIds.map(
                (agentId) => getAgent(agentId)?.name ?? agentId,
              );
              const membershipText = `${actorName} added ${names.join(", ")} to the channel.`;
              const membershipId = `${msg.messageId}:member-added`;
              const membershipEvent = {
                type: "message",
                id: membershipId,
                role: "user",
                content: [{ type: "text", text: membershipText }],
                mentions: newAgentIds,
                channelAction: {
                  type: "member-added",
                  actorName,
                  actorId: "workspace-owner",
                  actorType: "user",
                  agentIds: newAgentIds,
                },
              } satisfies AgentEvent;
              await channelBridge.mirrorEvent(
                manager,
                send,
                msg.workspaceId,
                msg.chatId,
                membershipEvent,
                destinationChannel?.id,
                undefined,
                broadcastChannelEvent,
              );
              openedSession.recordUserMessage(membershipText, membershipId, {
                mentions: newAgentIds,
                channelAction: {
                  type: "member-added",
                  actorName,
                  actorId: "workspace-owner",
                  actorType: "user",
                  agentIds: newAgentIds,
                },
              });
              await manager.waitForChatPersistence(msg.workspaceId, msg.chatId);
              const persistedMembership = (
                await manager.messages(msg.workspaceId, msg.chatId)
              ).find((message) => message.id === membershipId);
              if (persistedMembership) {
                send({
                  type: "message",
                  workspaceId: msg.workspaceId,
                  chatId: msg.chatId,
                  message: persistedMembership,
                });
              }
            }
            const isSharedChannel = destinationChannel?.visibility !== "direct";
            const respondingAgentId = channelRespondingAgentId({
              channelId: destinationChannel?.id,
              isSharedChannel,
              mentions: msg.mentions,
            });
            // Follow-ups are durable before any interruption or execution
            // wait. That keeps the user's message visible even if stopping the
            // active provider takes a moment or fails and must fall back to a
            // normal wait.
            const shouldPreempt = [
              msg.interruptActive,
              openedSession.isBusy,
            ].some(Boolean);
            const recordedBeforeExecution =
              Boolean(isSharedChannel) || shouldPreempt;
            if (recordedBeforeExecution) {
              openedSession.recordUserMessage(msg.text, msg.messageId, {
                threadRootId: msg.threadRootId,
                mentions: msg.mentions,
                attachments,
              });
              await manager.waitForChatPersistence(msg.workspaceId, msg.chatId);
              const persistedMessage = (
                await manager.messages(msg.workspaceId, msg.chatId)
              ).find((message) => message.id === msg.messageId);
              if (persistedMessage) {
                send({
                  type: "message",
                  workspaceId: msg.workspaceId,
                  chatId: msg.chatId,
                  message: persistedMessage,
                });
              }
            }
            let agentActivity:
              { channelId: string; reactionId: string } | undefined;
            let channelMessageMirrored = false;
            if (respondingAgentId && destinationChannel) {
              const respondingAgent = getAgent(respondingAgentId);
              if (!respondingAgent) {
                throw new Error(
                  `${respondingAgentId} persona is missing from this workspace.`,
                );
              }
              const targetEvent = await channelBridge.mirrorEvent(
                manager,
                send,
                msg.workspaceId,
                msg.chatId,
                {
                  type: "message",
                  id: msg.messageId,
                  role: "user",
                  content: [
                    ...(msg.text
                      ? [{ type: "text" as const, text: msg.text }]
                      : []),
                    ...(attachments ?? []).map((attachment) => ({
                      type: "image" as const,
                      ...attachment,
                    })),
                  ],
                  threadRootId: msg.threadRootId,
                  mentions: msg.mentions,
                },
                destinationChannel.id,
                undefined,
                broadcastChannelEvent,
              );
              channelMessageMirrored = Boolean(targetEvent);
              if (targetEvent) {
                try {
                  agentActivity = {
                    channelId: destinationChannel.id,
                    reactionId: await channelBridge.beginAgentActivityReaction(
                      manager,
                      send,
                      msg.workspaceId,
                      destinationChannel.id,
                      targetEvent.id,
                      {
                        id: respondingAgent.id,
                        name: respondingAgent.name,
                      },
                    ),
                  };
                } catch (error) {
                  console.error("[runtime] agent activity reaction:", error);
                }
              }
            }
            if (isSharedChannel && !respondingAgentId) {
              break;
            }
            const finishAgentActivity = async () => {
              const current = agentActivity;
              agentActivity = undefined;
              if (!current) return;
              await channelBridge.endAgentActivityReaction(
                manager,
                send,
                msg.workspaceId,
                current.channelId,
                current.reactionId,
              );
            };
            if (shouldPreempt) {
              try {
                await openedSession.interrupt();
              } catch (error) {
                // The follow-up is already durable. If the provider cannot be
                // interrupted cleanly, execution acquisition below waits for
                // its terminal event instead of dropping the user's message.
                console.error("[runtime] interrupt before follow-up:", error);
              } finally {
                manager.releaseExecution(
                  msg.workspaceId,
                  msg.chatId,
                  "interactive",
                );
              }
            }
            let releaseExecution: (() => void) | undefined;
            let session = openedSession;
            let releaseOnTerminal: ((event: AgentEvent) => void) | undefined;
            try {
              releaseExecution = await manager.acquireExecutionWhenAvailable(
                msg.workspaceId,
                msg.chatId,
                "interactive",
              );
              const setupSkill = setupSkillFromPrompt(msg.text);
              if (setupSkill?.domain) {
                integrationSetups.assignDomain(
                  msg.workspaceId,
                  msg.chatId,
                  setupSkill.domain,
                );
              }
              // A chat can be opened while its isolated Executor daemon is
              // still recovering. Never let that one transient failure leave
              // a long-lived provider continuation without Chief's internal
              // tools: reattach the current workspace tool server immediately
              // before every turn that is actually addressed to an agent.
              const executorWorkspace = await ensureExecutorWorkspace(
                msg.workspaceId,
                msg.executorCapability,
              );
              session = await manager.ensureRootChat(
                session.agent,
                msg.chatId,
                {
                  ...session.config,
                  mcpServers: [
                    executorToolServer(
                      executorWorkspace,
                      integrationSetups.domain(msg.workspaceId, msg.chatId)
                        ? "browser"
                        : session.config.access === "full"
                          ? "model"
                          : "browser",
                    ),
                  ],
                },
              );
              bindRootSession(msg.workspaceId, msg.chatId, session);
              const firstLine = msg.text.split("\n", 1)[0] ?? "";
              if (
                firstLine.startsWith(SETUP_ATTEMPT_PREFIX) &&
                firstLine.endsWith("]")
              ) {
                const domain =
                  setupSkill?.domain ??
                  integrationSetups.domain(msg.workspaceId, msg.chatId);
                const attemptId = firstLine.slice(
                  SETUP_ATTEMPT_PREFIX.length,
                  -1,
                );
                if (domain && attemptId) {
                  const prepared = await prepareIntegrationSetup(
                    msg.workspaceId,
                    msg.executorCapability,
                    domain,
                  );
                  integrationSetups.activate(msg.workspaceId, msg.chatId, {
                    attemptId,
                    domain,
                    integrationSlug: prepared.integrationSlug,
                    recipeId: prepared.recipeId,
                  });
                }
              }
              const execution = normalizedExecution(msg.execution);
              if (respondingAgentId && destinationChannel) {
                const respondingAgent = getAgent(respondingAgentId);
                if (!respondingAgent) {
                  throw new Error(
                    `${respondingAgentId} persona is missing from this workspace.`,
                  );
                }
                if (!channelMessageMirrored) {
                  await channelBridge.mirrorEvent(
                    manager,
                    send,
                    msg.workspaceId,
                    msg.chatId,
                    {
                      type: "message",
                      id: msg.messageId,
                      role: "user",
                      content: [
                        ...(msg.text
                          ? [{ type: "text" as const, text: msg.text }]
                          : []),
                        ...(attachments ?? []).map((attachment) => ({
                          type: "image" as const,
                          ...attachment,
                        })),
                      ],
                      threadRootId: msg.threadRootId,
                      mentions: msg.mentions,
                    },
                    destinationChannel.id,
                    undefined,
                    broadcastChannelEvent,
                  );
                }
                const preference =
                  (await manager.agentPreference(
                    msg.workspaceId,
                    respondingAgentId,
                  )) ?? (await manager.agentPreference(msg.workspaceId, "cmo"));
                const effectiveAgent = channelBridge.agentForChannel(
                  respondingAgent,
                  undefined,
                  await manager.store
                    .channelStore()
                    .get(msg.workspaceId, destinationChannel.id),
                  readWorkspaceContext(msg.workspaceId),
                );
                session = await manager.switchRootChatAgent(
                  effectiveAgent,
                  msg.chatId,
                  {
                    ...session.config,
                    driver: preference?.driver ?? session.config.driver,
                    model: preference?.model ?? session.config.model,
                  },
                );
                bindRootSession(msg.workspaceId, msg.chatId, session);
              }
              if (
                execution &&
                (execution.driver !== session.config.driver ||
                  execution.model !== session.config.model)
              ) {
                session = await manager.switchRootChatExecution(
                  session.agent,
                  msg.chatId,
                  {
                    ...session.config,
                    driver: execution.driver,
                    model: execution.model,
                  },
                );
                bindRootSession(msg.workspaceId, msg.chatId, session);
              }
              releaseOnTerminal = (event: AgentEvent) => {
                if (
                  event.type === "result" ||
                  event.type === "error" ||
                  event.type === "exit"
                ) {
                  session.off("event", releaseOnTerminal!);
                  releaseExecution?.();
                  releaseExecution = undefined;
                  void finishAgentActivity().catch((error: unknown) =>
                    console.error(
                      "[runtime] agent activity reaction cleanup:",
                      error,
                    ),
                  );
                }
              };
              session.on("event", releaseOnTerminal);
              const replyThreadRootId = channelReplyThreadRoot({
                isSharedChannel: Boolean(isSharedChannel),
                mentions: msg.mentions,
                messageId: msg.messageId,
                text: msg.text,
                threadRootId: msg.threadRootId,
              });
              if (process.env.CHIEF_DEBUG_SESSION_FORCE === "1") {
                console.error(
                  `[sendMessage] chatId=${msg.chatId} threadRootId=${
                    msg.threadRootId ?? "none"
                  } mentions=${JSON.stringify(msg.mentions ?? [])} shared=${
                    isSharedChannel ? "y" : "n"
                  } resolvedThreadRoot=${replyThreadRootId ?? "none"}`,
                );
              }
              await session.sendPrompt(
                msg.text,
                msg.messageId,
                !recordedBeforeExecution,
                {
                  threadRootId: replyThreadRootId,
                  mentions: msg.mentions,
                  attachments,
                  privateInstructions: setupSkill
                    ? `Setup skill ${setupSkill.id}:\n${setupSkill.instructions}`
                    : undefined,
                },
              );
            } catch (error) {
              if (releaseOnTerminal) {
                session.off("event", releaseOnTerminal);
              }
              await finishAgentActivity().catch((reactionError: unknown) =>
                console.error(
                  "[runtime] agent activity reaction cleanup:",
                  reactionError,
                ),
              );
              releaseExecution?.();
              throw error;
            }
            break;
          }

          case "interruptChat":
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await manager.assertInteractiveChat(msg.workspaceId, msg.chatId);
            try {
              await (
                await manager.rootChat(msg.workspaceId, msg.chatId)
              ).session?.interrupt();
            } finally {
              manager.releaseExecution(
                msg.workspaceId,
                msg.chatId,
                "interactive",
              );
            }
            break;

          case "respondPermission": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await manager.assertInteractiveChat(msg.workspaceId, msg.chatId);
            const { session } = await manager.rootChat(
              msg.workspaceId,
              msg.chatId,
            );
            session?.respondPermission(msg.requestId, msg.behavior);
            break;
          }

          case "respondQuestion": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await manager.assertInteractiveChat(msg.workspaceId, msg.chatId);
            const { session } = await manager.rootChat(
              msg.workspaceId,
              msg.chatId,
            );
            session?.respondQuestion(msg.requestId, msg.answers);
            break;
          }

          case "queryInputs": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            const stored = new Set(
              await workspaceSecrets.keys(msg.workspaceId),
            );
            const present = msg.keys.filter(
              (key) =>
                stored.has(key) ||
                equivalentInputKeys[key]?.some((alias) => stored.has(alias)),
            );
            send({
              type: "inputsStatus",
              workspaceId: msg.workspaceId,
              present,
            });
            break;
          }

          case "storeInput": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await storeInputValues(
              msg.workspaceId,
              msg.request,
              msg.values,
              false,
              msg.executorCapability,
            );
            send({
              type: "inputsStatus",
              workspaceId: msg.workspaceId,
              present: await workspaceSecrets.keys(msg.workspaceId),
            });
            send({
              type: "workspaceEnvironmentVariables",
              workspaceId: msg.workspaceId,
              variables: (await workspaceSecrets.keys(msg.workspaceId)).map(
                (key) => ({ key, sensitive: true as const }),
              ),
            });
            break;
          }

          case "disconnectGoogleAnalytics": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await disconnectGoogleAnalyticsConnection(
              msg.workspaceId,
              msg.executorCapability,
            );
            send({
              type: "integrationDisconnected",
              workspaceId: msg.workspaceId,
              provider: "google-analytics",
              requestId: msg.requestId,
            });
            break;
          }

          case "listWorkspaceEnvironmentVariables": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            send({
              type: "workspaceEnvironmentVariables",
              workspaceId: msg.workspaceId,
              variables: (await workspaceSecrets.keys(msg.workspaceId)).map(
                (key) => ({ key, sensitive: true as const }),
              ),
            });
            break;
          }

          case "saveWorkspaceEnvironmentVariable": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            if (!msg.value) throw new Error("Environment value is required.");
            await workspaceSecrets.storeEnv(
              msg.workspaceId,
              msg.key,
              msg.value,
            );
            await workspaceSecrets.refresh(msg.workspaceId);
            send({
              type: "workspaceEnvironmentVariables",
              workspaceId: msg.workspaceId,
              variables: (await workspaceSecrets.keys(msg.workspaceId)).map(
                (key) => ({ key, sensitive: true as const }),
              ),
            });
            break;
          }

          case "deleteWorkspaceEnvironmentVariable": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            await workspaceSecrets.deleteEnv(msg.workspaceId, msg.key);
            send({
              type: "workspaceEnvironmentVariables",
              workspaceId: msg.workspaceId,
              variables: (await workspaceSecrets.keys(msg.workspaceId)).map(
                (key) => ({ key, sensitive: true as const }),
              ),
            });
            break;
          }

          case "inspectWorkspaceIntegrations": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            const googleAnalytics = await inspectGoogleAnalyticsConfiguration(
              msg.workspaceId,
              msg.executorCapability,
            );
            const unhealthy = ["error", "failed", "unhealthy"].includes(
              googleAnalytics.connection?.lastHealth?.status ?? "",
            );
            send({
              type: "localIntegrationStatus",
              workspaceId: msg.workspaceId,
              integrations: [
                {
                  provider: "google-analytics",
                  category: "analytics",
                  status:
                    googleAnalytics.connection && !unhealthy
                      ? ("connected" as const)
                      : ("needs-authorization" as const),
                  needsCredentials: !googleAnalytics.oauthClientConfigured,
                  ...(googleAnalytics.connection?.identityLabel
                    ? { displayName: googleAnalytics.connection.identityLabel }
                    : {}),
                },
              ],
            });
            break;
          }

          case "provideInput": {
            await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
            if (!msg.recurringWorkId) {
              await manager.assertInteractiveChat(msg.workspaceId, msg.chatId);
            }
            const inspected = msg.recurringWorkId
              ? await manager.inspectChat(msg.workspaceId, msg.chatId)
              : await manager.rootChat(msg.workspaceId, msg.chatId);
            const session = inspected.session;
            if (msg.recurringWorkId) {
              if (
                inspected.chat.kind !== "task" ||
                inspected.chat.visibility !== "private" ||
                inspected.chat.scheduleId !== msg.recurringWorkId
              ) {
                throw new Error("Schedule does not own this private session.");
              }
            }
            if (!session || msg.recurringWorkId) {
              await manager.waitForChatPersistence(msg.workspaceId, msg.chatId);
              const events = session ? session.events : inspected.events;
              if (hasInputReceipt(events, msg.request.id)) break;
              const saved = await storeInputValues(
                msg.workspaceId,
                msg.request,
                msg.values,
                Boolean(
                  msg.recurringWorkId &&
                  verifyContextRequest(
                    msg.workspaceId,
                    msg.recurringWorkId,
                    msg.request,
                  ),
                ),
                msg.executorCapability,
              );
              const receipt = inputReceipt(msg.request, saved);
              if (session) {
                session.recordUserMessage(receipt);
                await manager.waitForChatPersistence(
                  msg.workspaceId,
                  msg.chatId,
                );
              } else {
                const chat = await manager.chat(msg.workspaceId, msg.chatId);
                if (!chat?.driver) {
                  throw new Error(
                    "The original session transcript is unavailable.",
                  );
                }
                await manager.saveTranscript(
                  {
                    id: msg.chatId,
                    organizationId: msg.workspaceId,
                    agentId: "cmo",
                    driver: chat.driver,
                    model: chat.model,
                  },
                  [
                    ...events,
                    {
                      type: "message",
                      role: "user",
                      content: [{ type: "text", text: receipt }],
                    },
                  ],
                  chat.title,
                );
              }
              send({
                type: "workspaceEnvironmentVariables",
                workspaceId: msg.workspaceId,
                variables: (await workspaceSecrets.keys(msg.workspaceId)).map(
                  (key) => ({ key, sensitive: true as const }),
                ),
              });
              if (msg.recurringWorkId) {
                void scheduler
                  .resumeAfterCurrent(msg.workspaceId, msg.recurringWorkId)
                  .catch((error) =>
                    console.error(
                      "[scheduler] could not resume session after input:",
                      error,
                    ),
                  );
              }
              break;
            }
            if (hasInputReceipt(session.events, msg.request.id)) break;
            const saved = await storeInputValues(
              session.config.workspaceId,
              msg.request,
              msg.values,
              false,
              msg.executorCapability,
            );
            await session.sendPrompt(inputReceipt(msg.request, saved));
            send({
              type: "workspaceEnvironmentVariables",
              workspaceId: session.config.workspaceId,
              variables: (
                await workspaceSecrets.keys(session.config.workspaceId)
              ).map((key) => ({ key, sensitive: true as const })),
            });
            break;
          }
        }
      } catch (err) {
        console.error(
          `[chief] ${msg.type} failed:`,
          err instanceof Error ? err.message : err,
        );
        send({
          type: "error",
          message: safeRuntimeError(err),
          ...(isDeploymentNotFound(err)
            ? { code: "deployment_not_found" as const }
            : {}),
          chatId: "chatId" in msg ? msg.chatId : undefined,
          requestId: "requestId" in msg ? msg.requestId : undefined,
        });
      }
    });

    ws.on("close", () => {
      for (const subscriptionKey of subscriptions) {
        const registered = sessionListeners.get(subscriptionKey);
        if (registered) registered.session.off("event", registered.listener);
        const separator = subscriptionKey.indexOf("\0");
        void manager.release(
          subscriptionKey.slice(0, separator),
          subscriptionKey.slice(separator + 1),
        );
      }
      sessionListeners.clear();
      subscriptions.clear();
    });
  });

  // The scheduler dispatches approved unattended work, so only the process
  // that actually owns the port may run it — a second runtime (stale watcher,
  // installed app next to dev) polling the same database must stay passive.
  http4.on("listening", () => {
    console.log(`[chief] agent runtime listening on ws://127.0.0.1:${port}`);
    const startupCutoff = Date.now();
    void manager
      .reconcileInterruptedSpecialistSessions(startupCutoff)
      .then(() =>
        manager.reconcileStaleActivitySessions(startupCutoff - 10 * 60_000),
      )
      .then(() => scheduler.start())
      .then(() => {
        schedulerReady = true;
      })
      .catch((error) =>
        console.error("[scheduler] startup recovery failed:", error),
      );
  });
  http4.on("error", (error) => {
    console.error(
      `[chief] could not bind port ${port} (another runtime running?); scheduler stays off:`,
      error,
    );
  });

  const shutdown = async () => {
    schedulerReady = false;
    scheduler.stop();
    await Promise.all(
      [...slackGateways.values()].map((gateway) =>
        gateway.stop().catch(() => undefined),
      ),
    );
    await scheduler.cancelActive();
    await scheduler.drain();
    await manager.stopSessions();
    await manager.stopAll();
    await browsers.closeAll();
    wss.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  return wss;
}

startServer();
