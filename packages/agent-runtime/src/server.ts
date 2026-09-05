import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import type { JsonValue } from "@chief/relay-contracts";
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
import {
  isJsonString,
  parseJsonObject,
  parseJsonValue,
} from "@chief/relay-contracts";

import type { ChannelEvent } from "./channel-types.js";
import type { LocalToolContext } from "./local-tools.js";
import type { AgentSession } from "./session.js";
import type {
  AgentEvent,
  BrowserAutomationCommand,
  BrowserAutomationResult,
  BrowserPageSnapshot,
  BrowserPresentationMode,
  ClientMessage,
  ExecutorCapability,
  IntegrationSetupProgress,
  RuntimeNotice,
  ServerMessage,
} from "./types.js";
import { createAgentLocalMcpHandler } from "./agent-local-mcp.js";
import { AgentSessionCapabilityRegistry } from "./agent-session-capabilities.js";
import { combinedAgentToolPermissionCeiling } from "./agent-tool-permissions.js";
import {
  composeWorkspaceInstructions,
  defaultAgents,
  getAgent,
} from "./agents.js";
import { createBrowserBroadcasts } from "./browser-broadcasts.js";
import {
  BrowserSessionRegistry,
  browserThreadRoot,
  integrationBrowserProfile,
  repairLegacyGoogleAuthBrowserOwners,
  resumableBrowserRuns,
} from "./browser-session-registry.js";
import { browserStateEncryptionKey } from "./browser-state-encryption.js";
import {
  availableCapabilities,
  composeAgentCapabilities,
} from "./capabilities/index.js";
import { startMentionedAgentThreads } from "./channel-mention-starter.js";
import { handleGovernanceRequest } from "./channels/governance-bridge.js";
import { createChannelLocalToolContext } from "./channels/local-tool-context.js";
import { channelChatId } from "./channels/nip29.js";
import * as channelBridge from "./channels/server-bridge.js";
import {
  loadSlackGatewayConfig,
  readSlackGatewaySettings,
  writeSlackGatewaySettings,
} from "./channels/slack-config.js";
import { SlackGateway } from "./channels/slack-gateway.js";
import { parseClientMessage } from "./client-message-parser.js";
import { cloudRecordsSchema } from "./cloud-records.js";
import {
  isDeploymentNotFound,
  safeRuntimeError,
} from "./deployment-failure.js";
import { initializeEveDeploymentTelemetry } from "./eve-deployment-telemetry-node.js";
import { captureAndStoreGeneratedCredential } from "./generated-credential-capture.js";
import { googleAnalyticsBrowserProgress } from "./google-browser-progress.js";
import { googleOAuthAuthenticatedBrowserPrompt } from "./google-oauth-browser-prompt.js";
import { guardedRequestHandler } from "./http-runtime.js";
import { hasInputReceipt, inputReceipt } from "./input-receipt.js";
import { verifyContextRequest } from "./input-values.js";
import { GOOGLE_ANALYTICS_DOMAIN } from "./integration-requests.js";
import {
  completedSetupResult,
  IntegrationSetupRegistry,
} from "./integration-setup-state.js";
import { handleLocalTool, localToolsOpenApi } from "./local-tools.js";
import { SessionManager } from "./manager.js";
import { createChiefMcpHandler } from "./mcp-server.js";
import {
  MISSION_CONTROL_HEARTBEAT_OPERATION_KEY,
  syncMissionControlHeartbeat,
} from "./mission-control-heartbeat.js";
import { listModels } from "./models.js";
import { OnboardingMessagePacer } from "./onboarding-message-pacing.js";
import { authorizeOrganizationRole } from "./organization-authorization.js";
import { PluginRuntime } from "./plugins/runtime.js";
import {
  handleProjectClientMessage,
  projectWorkspaceSnapshotMessages,
} from "./projects/client-messages.js";
import { createProjectServices } from "./projects/services.js";
import { ProviderAuthentication } from "./provider-authentication.js";
import {
  rotateRecurringWorkWebhook,
  saveRecurringWorkSettings,
} from "./recurring-work-settings.js";
import { runtimeHealthResponse } from "./runtime-health.js";
import { resumeDriverBlockedWork } from "./scheduled-agent-config.js";
import { startScheduledChannelWork } from "./scheduled-channel-thread.js";
import { dispatchScheduledWorkEvent } from "./scheduled-work-triggers.js";
import { handleScheduledWorkWebhook } from "./scheduled-work-webhook.js";
import { RecurringWorkScheduler } from "./scheduler.js";
import {
  handleExpandRecurringWorkGrant,
  handleResolveActionRequest,
} from "./server-action-handlers.js";
import {
  createLocalToolsRoute,
  prepareCallerScopedToolBody,
} from "./server-local-tools-route.js";
import {
  chatControlEvents,
  equivalentInputKeys,
  isGoogleAnalyticsOAuthRequest,
  storeGoogleAnalyticsOAuthClientForWorkspace,
  storeInputValues,
} from "./server-message-helpers.js";
import { handleBootstrapOnboardingWork } from "./server-onboarding-handler.js";
import { handleOpenChat } from "./server-open-chat-handler.js";
import { handleSendMessage } from "./server-send-message-handler.js";
import { setupTaskCatalog } from "./setup-skills.js";
import { publishSpecialistFileToThread } from "./specialist-file-publication.js";
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
  syncExecutorAgentPermissionCeiling,
  verifyGoogleAnalyticsConnection,
} from "./tools/control-plane.js";
import { redactExecutorHandoffCredentials } from "./tools/redaction.js";
import { executorToolServer } from "./tools/spec.js";
import {
  listVercelEveDestinations,
  provisionVercelEveDeployment,
} from "./vercel-eve-provisioning.js";
import {
  capabilityWhoamiUrl,
  WorkspaceAuthorization,
} from "./workspace-authorization.js";
import { readWorkspaceContext } from "./workspace-context.js";
import { workspaceRoot, workspaceSecrets } from "./workspace-secrets.js";
import { broadcastWorkspaceSockets } from "./workspace-socket-broadcast.js";
import {
  readWorkspaceWaysOfWorking,
  saveWorkspaceWaysOfWorking,
} from "./workspace-ways-of-working.js";

function reportSessionEventError(error: Error): void {
  console.error("[runtime] session event failed:", error);
}

const PORT = Number(process.env.CHIEF_RUNTIME_PORT ?? 4318);

/**
 * The agent service. Binds loopback-only; clients (desktop app today,
 * Slack/Discord bridges or a phone via tunnel later) speak the same JSON
 * protocol. Designed to run anywhere node runs — laptop, Raspberry Pi.
 */
export function startServer(port = PORT) {
  initializeEveDeploymentTelemetry();
  const localToolCapabilities = new AgentSessionCapabilityRegistry();
  const manager = new SessionManager();
  const projects = createProjectServices(manager.store.projectStore());
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
  const onboardingMessagePacer = new OnboardingMessagePacer();
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
  const integrationBrowserRuns = new Set<string>();
  const browsers = new BrowserSessionRegistry((workspaceId, browserRunId) => {
    const key = `${workspaceId}\0${browserRunId}`;
    const isIntegrationSetup = integrationBrowserRuns.has(browserRunId);
    return new AgentBrowserSession({
      sessionId: `chief-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
      downloadPath: join(
        workspaceRoot(workspaceId),
        ".browser",
        createHash("sha256").update(browserRunId).digest("hex").slice(0, 16),
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
  const browserRunConversations = new Map<string, string>();
  const browserRunsByExecution = new Map<string, string>();
  const browserSession = (workspaceId: string, browserRunId: string) =>
    browsers.session(workspaceId, browserRunId);
  const browserRunIdFor = (
    workspaceId: string,
    conversationId: string,
    requestedBrowserRunId?: string,
  ) => {
    if (requestedBrowserRunId) {
      if (
        browserRunConversations.get(requestedBrowserRunId) !== conversationId
      ) {
        throw new Error(
          "This browsing session does not belong to the conversation.",
        );
      }
      return requestedBrowserRunId;
    }
    return browserRunIds.get(browserKey(workspaceId, conversationId));
  };
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
    const body = parseJsonObject(await response.json().catch(() => null));
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
  let broadcastPlugins = (_workspaceId: string) => Promise.resolve();
  let broadcastProjects = (_workspaceId: string) => Promise.resolve();
  let broadcastBrowserNavigate = (
    _workspaceId: string,
    _conversationId: string,
    _url: string,
    _streamUrl: string,
    _browserRunId?: string,
  ): void => undefined;
  let broadcastBrowserPrepare = (
    _workspaceId: string,
    _conversationId: string,
    _url: string,
    _browserRunId?: string,
  ): void => undefined;
  let broadcastBrowserClosed = (
    _workspaceId: string,
    _conversationId: string,
    _browserRunId?: string,
  ): void => undefined;
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
    _browserRunId?: string,
  ): void => undefined;
  let broadcastBrowserPresentation = (
    _workspaceId: string,
    _conversationId: string,
    _mode: BrowserPresentationMode,
    _browserRunId?: string,
  ): void => undefined;
  let broadcastIntegrationSetupProgress = (
    _workspaceId: string,
    _conversationId: string,
    _progress: IntegrationSetupProgress,
  ) => undefined;
  const plugins = new PluginRuntime((workspaceId) => {
    void broadcastPlugins(workspaceId);
  });
  const completeBrowserRunPresentation = async (
    workspaceId: string,
    conversationId: string,
    requestedBrowserRunId?: string,
  ) => {
    const key = browserKey(workspaceId, conversationId);
    const browserRunId = browserRunIdFor(
      workspaceId,
      conversationId,
      requestedBrowserRunId,
    );
    if (browserRunId) {
      const session = browserSession(workspaceId, browserRunId);
      const [url, title] = await Promise.all([
        session.getUrl().catch(() => undefined),
        session.getTitle().catch(() => undefined),
      ]);
      await manager.store.updateBrowserRun(workspaceId, browserRunId, {
        ...(url ? { url } : undefined),
        ...(title ? { title } : undefined),
        status: "complete",
      });
      broadcastBrowserClosed(workspaceId, conversationId, browserRunId);
      if (browserRunIds.get(key) === browserRunId) browserRunIds.delete(key);
      browserRunConversations.delete(browserRunId);
      browserRunsByExecution.forEach((runId, executionKey) => {
        if (runId === browserRunId) browserRunsByExecution.delete(executionKey);
      });
      browserThreadRoots.delete(browserRunId);
      browserParentConversations.delete(browserRunId);
      browserAnchorMessages.delete(browserRunId);
      integrationBrowserRuns.delete(browserRunId);
    }
  };
  const closeBrowserSession = async (
    workspaceId: string,
    conversationId: string,
    requestedBrowserRunId?: string,
  ) => {
    const key = browserKey(workspaceId, conversationId);
    const browserRunId = browserRunIdFor(
      workspaceId,
      conversationId,
      requestedBrowserRunId,
    );
    pendingGoogleAuthentication.delete(key);
    providerAuthentication.clear(workspaceId, conversationId);
    googleAccountSessions.delete(key);
    await completeBrowserRunPresentation(
      workspaceId,
      conversationId,
      browserRunId,
    );
    if (browserRunId) await browsers.close(workspaceId, browserRunId);
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
    const conversation = await manager.store.chatRecord(
      workspaceId,
      conversationId,
    );
    let resolvedThreadRootId = browserThreadRoot(
      threadRootId,
      requestedRun?.threadRootId,
      conversation?.triggerContext,
    );
    // Setup/OAuth-triggered opens don't carry the turn's thread context.
    // Derive it from the live session so the browser is associated with the
    // same thread its opening turn is streaming into.
    resolvedThreadRootId ??= manager.get(
      workspaceId,
      conversationId,
    )?.activeThreadRootId;
    resolvedThreadRootId ??= await manager
      .rootChat(workspaceId, conversationId)
      .then((result) => result.session?.activeThreadRootId)
      .catch(() => undefined);
    if (process.env.CHIEF_DEBUG_SESSION_FORCE === "1") {
      console.error(
        `[browser-open] workspace=${workspaceId} conversation=${conversationId} threadRoot=${resolvedThreadRootId ?? "none"} url=${url}`,
      );
    }
    let browserRunId = requestedRun?.id;
    if (browserRunId) {
      await manager.store.updateBrowserRun(workspaceId, browserRunId, {
        url,
        status: "active",
      });
    }
    if (!browserRunId) {
      browserRunId = randomUUID();
      const now = Date.now();
      await manager.store.saveBrowserRun({
        id: browserRunId,
        workspaceId,
        conversationId,
        ...(conversation?.parentId
          ? { parentConversationId: conversation.parentId }
          : undefined),
        ...(resolvedThreadRootId
          ? { threadRootId: resolvedThreadRootId }
          : undefined),
        url,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await manager.store.updateBrowserRun(workspaceId, browserRunId, {
        ...(conversation?.parentId
          ? { parentConversationId: conversation.parentId }
          : undefined),
        ...(resolvedThreadRootId
          ? { threadRootId: resolvedThreadRootId }
          : undefined),
        url,
      });
    }
    browserRunIds.set(key, browserRunId);
    browserRunConversations.set(browserRunId, conversationId);
    browserParentConversations.set(
      browserRunId,
      requestedRun?.parentConversationId ?? conversation?.parentId,
    );
    if (resolvedThreadRootId !== undefined) {
      browserThreadRoots.set(browserRunId, resolvedThreadRootId);
    }
    // Keep the first insertion point for the run. Re-opening or navigating the
    // same run must never clear its creator-message attachment.
    if (requestedRun?.anchorMessageId) {
      browserAnchorMessages.set(browserRunId, requestedRun.anchorMessageId);
    }
    if (integrationSetups.domain(workspaceId, conversationId)) {
      integrationBrowserRuns.add(browserRunId);
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
      broadcastBrowserPrepare(
        workspaceId,
        conversationId,
        lockedUrl,
        browserRunId,
      );
    }
    // Keep the remote page at a stable coordinate system and scale it into the
    // chat surface. Resizing Chromium to the rendered card made automation
    // coordinates drift whenever the thread panel changed width.
    const initialViewport = viewport ?? { width: 1280, height: 800 };
    const session = browserSession(workspaceId, browserRunId);
    const stream = await session
      .open(lockedUrl, initialViewport)
      .catch((error: Error) => {
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
      ...(title ? { title } : undefined),
    });
    reportGoogleBrowserStep(workspaceId, conversationId, currentUrl);
    broadcastBrowserNavigate(
      workspaceId,
      conversationId,
      currentUrl,
      stream.url,
      browserRunId,
    );
    return browserRunId;
  };
  const browserRecoveryTasks = new Map<string, Promise<void>>();
  const recoverBrowserRuns = (workspaceId: string) => {
    const current = browserRecoveryTasks.get(workspaceId);
    if (current) return current;
    const task = (async () => {
      const storedRuns = await manager.store.listBrowserRuns(workspaceId);
      const runs = await repairLegacyGoogleAuthBrowserOwners(
        manager.store,
        workspaceId,
        storedRuns,
      );
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
        if (browserRunConversations.has(run.id)) {
          try {
            const session = browserSession(workspaceId, run.id);
            const stream = await session.stream(5_000);
            const url = await session.getUrl().catch(() => run.url);
            broadcastBrowserNavigate(
              workspaceId,
              run.conversationId,
              url,
              stream.url,
              run.id,
            );
            continue;
          } catch {
            // The UI reconnected but the browser daemon did not. Replace only
            // the process wrapper; encrypted restore state remains available
            // to the bounded recovery loop below.
            await browsers.close(workspaceId, run.id);
          }
        }
        browserRunIds.set(key, run.id);
        browserRunConversations.set(run.id, run.conversationId);
        if (run.threadRootId !== undefined) {
          browserThreadRoots.set(run.id, run.threadRootId);
        }
        if (run.parentConversationId !== undefined) {
          browserParentConversations.set(run.id, run.parentConversationId);
        }
        if (run.anchorMessageId) {
          browserAnchorMessages.set(run.id, run.anchorMessageId);
        }
        broadcastBrowserPrepare(
          workspaceId,
          run.conversationId,
          run.url,
          run.id,
        );

        let recovered = false;
        let lastError: unknown;
        for (const delay of [0, 300, 1_000, 2_500]) {
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          try {
            const session = browserSession(workspaceId, run.id);
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
              ...(title ? { title } : undefined),
              status: "active",
            });
            broadcastBrowserNavigate(
              workspaceId,
              run.conversationId,
              url,
              stream.url,
              run.id,
            );
            recovered = true;
            break;
          } catch (error) {
            lastError = error;
            await browsers.close(workspaceId, run.id);
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
        broadcastBrowserClosed(workspaceId, run.conversationId, run.id);
        if (browserRunIds.get(key) === run.id) browserRunIds.delete(key);
        browserRunConversations.delete(run.id);
        browserThreadRoots.delete(run.id);
        browserParentConversations.delete(run.id);
        browserAnchorMessages.delete(run.id);
      }
    })().finally(() => browserRecoveryTasks.delete(workspaceId));
    browserRecoveryTasks.set(workspaceId, task);
    return task;
  };
  const requestBrowserCommand = async (
    workspaceId: string,
    conversationId: string,
    command: BrowserAutomationCommand,
    requestedBrowserRunId?: string,
  ): Promise<BrowserAutomationResult> => {
    const browserRunId = browserRunIdFor(
      workspaceId,
      conversationId,
      requestedBrowserRunId,
    );
    if (!browserRunId) {
      throw new Error("There is no active embedded browser to control.");
    }
    const session = browserSession(workspaceId, browserRunId);
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
      await manager.store.updateBrowserRun(workspaceId, browserRunId, {
        url: snapshot.url,
        title: snapshot.title,
      });
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
    broadcastBrowserActivity(
      workspaceId,
      conversationId,
      {
        phase: "started",
        label: activityLabel,
        ...(cursorState ? { cursor: cursorState } : undefined),
      },
      browserRunId,
    );
    const completed = () =>
      broadcastBrowserActivity(
        workspaceId,
        conversationId,
        {
          phase: "completed",
          label: activityLabel,
          ...(cursorState ? { cursor: cursorState } : undefined),
        },
        browserRunId,
      );
    const releaseCursor = () => {
      if (!cursorState) return;
      broadcastBrowserActivity(
        workspaceId,
        conversationId,
        {
          phase: "started",
          label: activityLabel,
          cursor: cursorState,
        },
        browserRunId,
      );
    };
    if (cursorState) {
      // Keep the browser action behind Browser UI's 680ms travel curve so the
      // cursor visibly reaches the target before the page responds.
      await new Promise((resolve) => setTimeout(resolve, 780));
      broadcastBrowserActivity(
        workspaceId,
        conversationId,
        {
          phase: "started",
          label: activityLabel,
          cursor: {
            ...cursorState,
            pressed: true,
            typing: command.type === "fill",
          },
        },
        browserRunId,
      );
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
  let continueChiefSession = (
    _workspaceId: string,
    _chatId: string,
    _receipt: string,
    _capability: ExecutorCapability,
    _threadRootId?: string,
  ) => Promise.resolve();
  let ensureChiefSession = (
    _workspaceId: string,
    _chatId: string,
    _capability: ExecutorCapability,
  ): Promise<AgentSession> =>
    Promise.reject(new Error("Chief is still starting this workspace."));
  const workspaceRevisions = new Map<string, number>();
  const workspaceSnapshotQueues = new Map<string, Promise<void>>();
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
          ).catch((error: Error) =>
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
    async (workspaceId, work, _scheduledFor, triggerContext) => {
      const capability = workspaceCapabilities.get(workspaceId);
      if (!capability) return false;
      return Boolean(
        await startScheduledChannelWork({
          // Scheduled agents publish deliberate channel updates through the
          // channel message tool. Their ordinary provider stream remains
          // private work and is available in Activity.
          bindSession: () => undefined,
          broadcast: broadcastChannelEvent,
          manager,
          prepareWorkspaceTools: () =>
            ensureExecutorWorkspace(workspaceId, capability).catch(() => null),
          triggerContext,
          workspaceId,
          work,
        }),
      );
    },
  );
  const syncCloudRecords = async (workspaceId: string) => {
    const active = cloudSyncs.get(workspaceId);
    if (active) return active;
    const sync = (async () => {
      const preference = await manager.agentPreference(workspaceId, "chief");
      const capability = workspaceCapabilities.get(workspaceId);
      if (preference?.driver !== "remote" || !capability) return;
      const response = await fetch(
        `${capability.apiBaseUrl.replace(/\/$/, "")}/agent-tools/records`,
        { headers: { Authorization: `Bearer ${capability.token}` } },
      );
      if (!response.ok) {
        throw new Error(`Cloud record sync returned ${response.status}.`);
      }
      const records = cloudRecordsSchema.parse(await response.json());
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
    const preference = await manager.agentPreference(workspaceId, "chief");
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
  ensureChiefSession = async (
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
    const agent = getAgent(setupDomain ? "setup" : "chief");
    if (!agent) throw new Error("Chief's agent persona is missing.");
    const preference = await manager.agentPreference(workspaceId, "chief");
    if (!preference?.driver || preference.enabled === false) {
      throw new Error("Configure Chief's agent app before continuing work.");
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
    ).catch((error: Error) => {
      console.error(
        `[runtime] Executor workspace unavailable for ${chatId}:`,
        error,
      );
      return null;
    });
    const pluginServers = await plugins.mcpServers(workspaceId);
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
            ...pluginServers,
          ]
        : pluginServers,
      executionOwner: "interactive",
    });
  };
  continueChiefSession = async (
    workspaceId,
    chatId,
    receipt,
    capability,
    owningThreadRootId,
  ) => {
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
            void dispatch().catch((error: Error) =>
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
        const threadRootId = owningThreadRootId ?? session.activeThreadRootId;
        await session.sendPrompt(receipt, undefined, true, {
          ...(threadRootId ? { threadRootId } : undefined),
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
    const browserRunId = browserRunIds.get(browserKey(workspaceId, sessionId));
    if (!browserRunId) return;
    const browser = browserSession(workspaceId, browserRunId);
    const stream = await browser.stream();
    broadcastBrowserNavigate(
      workspaceId,
      sessionId,
      url.toString(),
      stream.url,
      browserRunId,
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
    openBrowser: async (workspaceId, sessionId, url) => {
      const browserRunId = await openBrowserSession(
        workspaceId,
        sessionId,
        url,
      );
      browserRunsByExecution.set(
        browserKey(workspaceId, sessionId),
        browserRunId,
      );
      return {
        getUrl: () => browserSession(workspaceId, browserRunId).getUrl(),
      };
    },
    progress: (...args) => broadcastIntegrationSetupProgress(...args),
  });
  let localToolsRoute:
    ReturnType<typeof createLocalToolsRoute<LocalToolContext>> | undefined;
  // Bind both loopback families — macOS clients resolving "localhost" may
  // dial ::1 or 127.0.0.1. Never bind non-loopback interfaces here.
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const path = req.url
      ? new URL(req.url, `http://127.0.0.1:${port}`).pathname
      : "/";
    if (req.method === "GET" && path === "/healthz") {
      const health = runtimeHealthResponse();
      res.writeHead(health.status, health.headers);
      res.end(health.body);
      return;
    }
    if (await plugins.handleCallback(req, res)) return;
    if (req.method === "POST" && path.startsWith("/hooks/scheduled-runs/")) {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > 256_000) {
          res.writeHead(413, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Webhook payload is too large." }));
          return;
        }
        chunks.push(buffer);
      }
      let body: JsonValue = {};
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const parsed: unknown = raw ? JSON.parse(raw) : {};
        const value = parseJsonValue(parsed);
        if (value === undefined) throw new Error("Invalid JSON value.");
        body = value;
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Webhook payload must be JSON." }));
        return;
      }
      const result = await handleScheduledWorkWebhook({
        path,
        body,
        idempotencyKey: isJsonString(req.headers["idempotency-key"])
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
      localToolsRoute ??= createLocalToolsRoute({
        origin: `http://127.0.0.1:${port}`,
        capabilities: localToolCapabilities,
        workspaceCapabilities,
        manager,
        openApi: () => localToolsOpenApi(`http://127.0.0.1:${port}`),
        prepareBody: ({ body, caller, path, workspaceId }) => {
          // Bind private browser, setup, integration, and file effects to the
          // authenticated caller. Public channel delegation deliberately keeps
          // its explicit destination so agents can invite and address others.
          const activeSetup = integrationSetups.get(workspaceId, caller.chatId);
          prepareCallerScopedToolBody({
            path,
            body,
            callerAgentId: caller.agentId,
            callerChatId: caller.chatId,
            callerThreadRootId: caller.threadRootId,
            attemptId: activeSetup?.attemptId,
          });
        },
        createContext: async ({
          caller: activeCaller,
          capability: externalCapability,
          workspaceId,
        }): Promise<LocalToolContext> => ({
          onActivity: () => broadcastWorkspaceData(workspaceId),
          onFilesChanged: () => broadcastWorkspaceFiles(workspaceId),
          onFileWritten: async (file) => {
            const callerRecord = await manager.store.chatRecord(
              workspaceId,
              activeCaller.chatId,
            );
            const threadRootId = browserThreadRoot(
              undefined,
              undefined,
              callerRecord?.triggerContext,
            );
            if (!callerRecord?.parentId || !threadRootId) return;
            await publishSpecialistFileToThread(
              {
                manager,
                workspaceId,
                conversationId: callerRecord.parentId,
                threadRootId,
              },
              file,
            );
          },
          channels: await createChannelLocalToolContext({
            manager,
            workspaceId,
            caller: activeCaller,
            broadcastChannels: () => broadcastChannels(workspaceId),
            broadcastEvent: (event) =>
              broadcastChannelEvent(workspaceId, event),
            broadcastWorkspaceData: () => broadcastWorkspaceData(workspaceId),
            beforeMessagePost: ({ content, idempotencyKey }) =>
              onboardingMessagePacer.beforePost(workspaceId, {
                content,
                ...(idempotencyKey ? { idempotencyKey } : undefined),
              }),
            onAgentMentions: (channel, event, agentIds) => {
              startMentionedAgentThreads({
                manager,
                workspaceId,
                callerAgentId: activeCaller.agentId,
                channel,
                event,
                agentIds,
                onStateChange: () => broadcastWorkspaceData(workspaceId),
                onFilesChange: () => broadcastWorkspaceFiles(workspaceId),
                onChannelEvent: (event) =>
                  broadcastChannelEvent(workspaceId, event),
                onChannelsChanged: () => broadcastChannels(workspaceId),
              });
            },
            notifyDeletionRequest: (title) =>
              broadcastNotice(workspaceId, { kind: "action", title }),
          }),
          projects: {
            service: projects,
            organizationId: workspaceId,
            agentId: activeCaller.agentId,
            conversationId: activeCaller.chatId,
            onProjectsChanged: () => broadcastProjects(workspaceId),
          },
          scheduledWork: scheduler,
          openBrowser: async (
            _conversationId,
            url,
            fresh,
            requestedBrowserRunId,
          ) => {
            // The capability-bound caller owns browser placement.
            const callerRecord = await manager.store.chatRecord(
              workspaceId,
              activeCaller.chatId,
            );
            const callerThreadRootId =
              browserThreadRoot(
                undefined,
                undefined,
                callerRecord?.triggerContext,
              ) ??
              manager.get(workspaceId, activeCaller.chatId)?.activeThreadRootId;
            const resolvedOwner = activeCaller.chatId;
            const executionKey = browserKey(workspaceId, activeCaller.chatId);
            const exactRunId =
              requestedBrowserRunId ??
              (fresh ? undefined : browserRunsByExecution.get(executionKey));
            if (fresh && requestedBrowserRunId) {
              await closeBrowserSession(
                workspaceId,
                resolvedOwner,
                requestedBrowserRunId,
              );
            }
            const browserRunId = await openBrowserSession(
              workspaceId,
              resolvedOwner,
              url,
              undefined,
              callerThreadRootId,
              exactRunId,
            );
            browserRunsByExecution.set(executionKey, browserRunId);
            return browserRunId;
          },
          closeBrowser: async (_conversationId, requestedBrowserRunId) => {
            const browserRunId =
              requestedBrowserRunId ??
              browserRunsByExecution.get(
                browserKey(workspaceId, activeCaller.chatId),
              );
            const resolvedOwner = browserRunId
              ? (browserRunConversations.get(browserRunId) ??
                activeCaller.chatId)
              : activeCaller.chatId;
            await closeBrowserSession(workspaceId, resolvedOwner, browserRunId);
          },
          presentBrowser: (_conversationId, mode, requestedBrowserRunId) => {
            const browserRunId =
              requestedBrowserRunId ??
              browserRunsByExecution.get(
                browserKey(workspaceId, activeCaller.chatId),
              );
            if (!browserRunId) {
              throw new Error(
                "There is no active embedded browser to present.",
              );
            }
            broadcastBrowserPresentation(
              workspaceId,
              browserRunConversations.get(browserRunId) ?? activeCaller.chatId,
              mode,
              browserRunId,
            );
          },
          browserCommand: async (
            _conversationId,
            command,
            requestedBrowserRunId,
          ) => {
            const browserRunId =
              requestedBrowserRunId ??
              browserRunsByExecution.get(
                browserKey(workspaceId, activeCaller.chatId),
              );
            const resolvedOwner = browserRunId
              ? (browserRunConversations.get(browserRunId) ??
                activeCaller.chatId)
              : activeCaller.chatId;
            return requestBrowserCommand(
              workspaceId,
              resolvedOwner,
              command,
              browserRunId,
            );
          },
          activateIntegrationSetup: async (_sessionId, attemptId, domain) => {
            const sessionId = activeCaller.chatId;
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
          startSetup: async (_sessionId, domain) => {
            const sessionId = activeCaller.chatId;
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
          integrationSetup: {
            openIntegrationHandoff: async (_sessionId, attemptId, url) => {
              const sessionId = activeCaller.chatId;
              activeIntegrationSetup(workspaceId, sessionId, attemptId);
              const handoffUrl = await executorHandoffUrl(workspaceId, url);
              const browserRunId = await openBrowserSession(
                workspaceId,
                sessionId,
                handoffUrl,
              );
              browserRunsByExecution.set(
                browserKey(workspaceId, sessionId),
                browserRunId,
              );
            },
            openProviderPage: async (_sessionId, attemptId, rawTargetUrl) => {
              const sessionId = activeCaller.chatId;
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
            captureGeneratedCredential: async (_sessionId, attemptId) => {
              const sessionId = activeCaller.chatId;
              const setup = activeIntegrationSetup(
                workspaceId,
                sessionId,
                attemptId,
              );
              const browserRunId = browserRunsByExecution.get(
                browserKey(workspaceId, sessionId),
              );
              if (!browserRunId) {
                throw new Error("The setup browser is no longer active.");
              }
              return captureAndStoreGeneratedCredential({
                browser: browserSession(workspaceId, browserRunId),
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
              provisionClient: async (_sessionId, attemptId) => {
                // The capability-bound specialist is the durable owner. Falling
                // back to the currently visible root chat moved its browser out
                // of the thread whenever the model repeated a parent ID.
                const resolvedSessionId = activeCaller.chatId;
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
                broadcastIntegrationSetupProgress(
                  workspaceId,
                  resolvedSessionId,
                  {
                    recipeId: "google-analytics",
                    phase: "authenticated-session",
                    instruction:
                      "Sign in with the Google account that administers the Analytics property you want to connect. Chief will take control again automatically.",
                    status: "active",
                  },
                );
                const firstService = googleAnalyticsRecipe.services[0];
                if (!firstService)
                  throw new Error("Google API recipe is empty.");
                const browserRunId = await openBrowserSession(
                  workspaceId,
                  resolvedSessionId,
                  googleAccountChooserUrl(googleApiLibraryUrl(firstService)),
                );
                browserRunsByExecution.set(
                  browserKey(workspaceId, resolvedSessionId),
                  browserRunId,
                );
                return {
                  status: "authentication-required" as const,
                  instruction:
                    "The user only needs to complete Google sign-in. Chief will resume this same agent automatically and operate the browser from there.",
                };
              },
              captureClient: async (_sessionId, attemptId) => {
                const sessionId = activeCaller.chatId;
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
                const browserRunId = browserRunsByExecution.get(
                  browserKey(workspaceId, sessionId),
                );
                if (!browserRunId) {
                  throw new Error(
                    "The Google setup browser is no longer active.",
                  );
                }
                const client = await captureGoogleDesktopOAuthClient(
                  browserSession(workspaceId, browserRunId),
                );
                await storeGoogleAnalyticsOAuthClientForWorkspace(
                  workspaceId,
                  externalCapability,
                  {
                    clientId: client.clientId,
                    clientSecret: client.clientSecret,
                  },
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
              startAuthorization: async (_sessionId, attemptId) => {
                const sessionId = activeCaller.chatId;
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
                  clientId && clientSecret
                    ? { clientId, clientSecret }
                    : undefined,
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
              completeAuthorization: async (_sessionId, attemptId, state) => {
                const sessionId = activeCaller.chatId;
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
              selectProperty: async (_sessionId, attemptId, propertyId) => {
                const sessionId = activeCaller.chatId;
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
          },
          plugins: plugins.localTools(workspaceId),
        }),
        invoke: (request, workspaceId, context) =>
          handleLocalTool(request, workspaceId, manager, context),
        onSuccess: ({ path: completedPath, workspaceId }) => {
          void broadcastWorkspaceData(workspaceId);
          if (
            completedPath === "/local-tools/files/write" ||
            completedPath === "/local-tools/content"
          ) {
            void broadcastWorkspaceFiles(workspaceId);
          }
          if (completedPath === "/local-tools/action") {
            broadcastNotice(workspaceId, {
              kind: "action",
              title: "An agent flagged something for you",
            });
          }
        },
      });
      await localToolsRoute(req, res);
      return;
    }
    if (await handleAgentLocalMcp(req, res)) return;
    if (await handleMcp(req, res)) return;
    res.writeHead(204, { "access-control-allow-origin": "*" });
    res.end();
  };
  const handleAgentLocalMcp = createAgentLocalMcpHandler({
    authenticate: (token) => localToolCapabilities.authenticate(token),
    openApi: () => localToolsOpenApi(`http://127.0.0.1:${port}`),
    origin: `http://127.0.0.1:${port}`,
  });
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
  const sendWorkspace = (workspaceId: string, message: string) =>
    broadcastWorkspaceSockets(
      new Set([...wss.clients, ...wss6.clients]),
      (client) => socketAuthorization.canReceive(client, workspaceId),
      message,
    );
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
    sendWorkspace(workspaceId, message);
  };
  broadcastWorkspaceFiles = async (workspaceId) => {
    await syncCloudRecords(workspaceId);
    const message = JSON.stringify({
      type: "workspaceFiles",
      workspaceId,
      files: await manager.listWorkspaceFiles(workspaceId),
    });
    sendWorkspace(workspaceId, message);
  };
  broadcastPlugins = async (workspaceId) => {
    const snapshot = await plugins.snapshot(workspaceId);
    const message = JSON.stringify({
      type: "plugins",
      workspaceId,
      ...snapshot,
    });
    sendWorkspace(workspaceId, message);
  };
  broadcastProjects = async (workspaceId) => {
    for (const message of await projectWorkspaceSnapshotMessages(
      projects,
      workspaceId,
    )) {
      sendWorkspace(workspaceId, JSON.stringify(message));
    }
  };
  broadcastChannels = async (workspaceId) => {
    const message = JSON.stringify({
      type: "channels",
      workspaceId,
      channels: await manager.store.channelStore().list(workspaceId),
    } satisfies ServerMessage);
    sendWorkspace(workspaceId, message);
  };
  broadcastNotice = (workspaceId, notice) => {
    const message = JSON.stringify({
      type: "runtimeNotice",
      workspaceId,
      notice,
    });
    sendWorkspace(workspaceId, message);
  };
  broadcastChannelEvent = (workspaceId, event) => {
    const message = JSON.stringify({
      type: "channelEvent",
      workspaceId,
      event,
    } satisfies ServerMessage);
    sendWorkspace(workspaceId, message);
    void dispatchScheduledWorkEvent({
      workspaceId,
      event,
      manager,
      runner: scheduler,
    }).catch((error) =>
      console.error("[scheduled-work] channel trigger failed:", error),
    );
  };
  const browserBroadcasts = createBrowserBroadcasts({
    browserKey,
    runIds: browserRunIds,
    threadRoots: browserThreadRoots,
    parentConversations: browserParentConversations,
    anchorMessages: browserAnchorMessages,
    send: (workspaceId, browserMessage) => {
      const payload = JSON.stringify(browserMessage);
      sendWorkspace(workspaceId, payload);
    },
  });
  broadcastBrowserNavigate = browserBroadcasts.navigate;
  broadcastBrowserPrepare = browserBroadcasts.prepare;
  broadcastBrowserActivity = browserBroadcasts.activity;
  broadcastBrowserPresentation = browserBroadcasts.presentation;
  broadcastBrowserClosed = browserBroadcasts.closed;
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
    sendWorkspace(workspaceId, message);
  };
  broadcastIntegrationVerified = (workspaceId, integration) => {
    const message = JSON.stringify({
      type: "integrationVerified",
      workspaceId,
      ...integration,
    } satisfies ServerMessage);
    sendWorkspace(workspaceId, message);
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
        listener: (event: AgentEvent) => void;
      }
    >();
    const bindRootSession = (
      workspaceId: string,
      chatId: string,
      session: AgentSession,
    ) => {
      const subscriptionKey = `${workspaceId}\0${chatId}`;
      const registered = sessionListeners.get(subscriptionKey);
      if (registered?.session === session) return;
      if (registered) registered.session.off("event", registered.listener);
      if (!subscriptions.has(subscriptionKey)) {
        subscriptions.add(subscriptionKey);
        manager.retain(workspaceId, chatId);
      }
      const handleEvent = async (agentEvent: AgentEvent) => {
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
      const listener = (event: AgentEvent) => {
        void handleEvent(event).catch(reportSessionEventError);
      };
      session.on("event", listener);
      sessionListeners.set(subscriptionKey, { session, listener });
    };

    ws.on("message", (data) => {
      void (async () => {
        let msg: ClientMessage;
        try {
          const raw = Buffer.isBuffer(data)
            ? data.toString("utf8")
            : Array.isArray(data)
              ? Buffer.concat(data).toString("utf8")
              : Buffer.from(data).toString("utf8");
          msg =
            parseClientMessage(raw) ??
            (() => {
              throw new Error("invalid message");
            })();
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
              if (
                browserRunConversations.get(msg.browserRunId) !==
                msg.conversationId
              )
                return;
            }
            if (msg.type === "browserClose") {
              await closeBrowserSession(
                msg.workspaceId,
                msg.conversationId,
                msg.browserRunId,
              );
              return;
            }
            if (msg.type === "browserUrlChanged") {
              const url = new URL(msg.url);
              if (url.protocol !== "http:" && url.protocol !== "https:") {
                throw new Error("Browser URLs must use HTTP or HTTPS.");
              }
              const key = browserKey(msg.workspaceId, msg.conversationId);
              await manager.store.updateBrowserRun(
                msg.workspaceId,
                msg.browserRunId,
                { url: url.toString() },
              );
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
                    undefined,
                    undefined,
                    msg.browserRunId,
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
              const browser = browserSession(msg.workspaceId, msg.browserRunId);
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
                  msg.browserRunId,
                );
              } else {
                if (
                  !browsers.resolveViewport(msg.workspaceId, msg.browserRunId, {
                    width: msg.width,
                    height: msg.height,
                  })
                ) {
                  await browsers.resize(msg.workspaceId, msg.browserRunId, {
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
          if (
            await plugins.handleClientMessage(msg, authorizeWorkspace, send)
          ) {
            return;
          }
          if (
            await handleProjectClientMessage(msg, {
              service: projects,
              authorize: authorizeWorkspace,
              send,
              broadcast: broadcastProjects,
            })
          )
            return;
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
                const runs = await manager.store.listBrowserRuns(
                  msg.workspaceId,
                );
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
              browserAnchorMessages.set(msg.browserRunId, msg.messageId);
              break;

            case "listWorkspaceData": {
              await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
              const waysOfWorking = readWorkspaceWaysOfWorking(msg.workspaceId);
              if (
                waysOfWorking.mode === "mission-control" &&
                !(await manager.recurringWorkByOperationKey(
                  msg.workspaceId,
                  MISSION_CONTROL_HEARTBEAT_OPERATION_KEY,
                ))
              ) {
                await syncMissionControlHeartbeat(
                  manager,
                  msg.workspaceId,
                  waysOfWorking,
                );
              }
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

            case "saveWorkspaceWaysOfWorking": {
              await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
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
                  "Only workspace owners and admins can change ways of working.",
                sessionToken: msg.sessionToken,
                workspaceId: msg.workspaceId,
              });
              const channel =
                msg.mode === "mission-control"
                  ? await manager.store
                      .channelStore()
                      .get(msg.workspaceId, msg.missionControlChannelId)
                  : undefined;
              if (msg.mode === "mission-control") {
                if (
                  !channel ||
                  channel.visibility === "direct" ||
                  channel.lifecycle !== "active"
                ) {
                  throw new Error("Choose an active workspace channel.");
                }
                if (!channel.agentIds.includes("chief")) {
                  await manager.store
                    .channelStore()
                    .setAgents(msg.workspaceId, channel.id, [
                      ...channel.agentIds,
                      "chief",
                    ]);
                  await broadcastChannels(msg.workspaceId);
                }
              }
              const waysOfWorking = saveWorkspaceWaysOfWorking(
                msg.workspaceId,
                msg.mode,
                channel?.id ?? msg.missionControlChannelId,
              );
              await syncMissionControlHeartbeat(
                manager,
                msg.workspaceId,
                waysOfWorking,
              );
              send({
                type: "workspaceWaysOfWorkingSaved",
                workspaceId: msg.workspaceId,
                requestId: msg.requestId,
                waysOfWorking,
              });
              await broadcastWorkspaceData(msg.workspaceId);
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
              await handleBootstrapOnboardingWork({
                authorizeWorkspace,
                bindRootSession,
                broadcastChannels,
                broadcastWorkspaceData,
                chatDestinations,
                manager,
                msg,
                onboardingBootstraps,
                send,
              });
              break;
            }
            case "saveCampaign":
              await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
              await manager.saveCampaign(msg.workspaceId, msg.campaign);
              await broadcastWorkspaceData(msg.workspaceId);
              break;
            case "saveRecurringWork": {
              await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
              const { saved, missedOneOff } = await saveRecurringWorkSettings(
                manager,
                msg.workspaceId,
                msg.work,
              );
              if (saved.status === "active") {
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
              if (msg.requestId) {
                send({
                  type: "recurringWorkSaved",
                  workspaceId: msg.workspaceId,
                  requestId: msg.requestId,
                  work: saved,
                });
              }
              if (missedOneOff) {
                void scheduler
                  .runNow(msg.workspaceId, msg.work.id)
                  .catch((error) => console.error("[recurring-work]", error));
              }
              break;
            }

            case "rotateRecurringWorkWebhook": {
              await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
              const url = await rotateRecurringWorkWebhook(
                manager,
                msg.workspaceId,
                msg.recurringWorkId,
                `http://127.0.0.1:${PORT}`,
              );
              send({
                type: "recurringWorkWebhookRotated",
                workspaceId: msg.workspaceId,
                requestId: msg.requestId,
                recurringWorkId: msg.recurringWorkId,
                url,
                reachability: "local_only",
              });
              break;
            }

            case "runRecurringWorkNow":
              await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
              void scheduler
                .runNow(msg.workspaceId, msg.recurringWorkId)
                .catch((error) => console.error("[recurring-work]", error));
              break;

            case "runMissionControlHeartbeatNow": {
              await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
              const work = await manager.recurringWorkByOperationKey(
                msg.workspaceId,
                MISSION_CONTROL_HEARTBEAT_OPERATION_KEY,
              );
              if (!work) throw new Error("The heartbeat is not ready yet.");
              const started = await startScheduledChannelWork({
                bindSession: bindRootSession,
                broadcast: broadcastChannelEvent,
                manager,
                onThread: (thread) => {
                  chatDestinations.set(
                    `${msg.workspaceId}\0${thread.chatId}`,
                    thread.channelId,
                  );
                  send({
                    type: "missionControlHeartbeatStarted",
                    workspaceId: msg.workspaceId,
                    requestId: msg.requestId,
                    channelId: thread.channelId,
                    messageId: thread.messageId,
                    threadRootId: thread.messageId,
                  });
                },
                prepareWorkspaceTools: () =>
                  ensureExecutorWorkspace(
                    msg.workspaceId,
                    msg.executorCapability,
                  ).catch(() => null),
                work,
                workspaceId: msg.workspaceId,
              });
              if (!started) {
                throw new Error("Chief is not ready to run this heartbeat.");
              }
              break;
            }

            case "dismissActionItem":
              await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
              await manager.dismissActionItem(
                msg.workspaceId,
                msg.actionItemId,
              );
              await dismissCloudAction(msg.workspaceId, msg.actionItemId);
              await broadcastWorkspaceData(msg.workspaceId);
              break;

            case "resolveActionRequest": {
              await handleResolveActionRequest({
                authorizeWorkspace,
                broadcastWorkspaceData,
                continueChiefSession,
                dismissCloudAction,
                integrationSetups,
                manager,
                msg,
                send,
              });
              break;
            }

            case "expandRecurringWorkGrant": {
              await handleExpandRecurringWorkGrant({
                authorizeWorkspace,
                broadcastWorkspaceData,
                manager,
                msg,
                scheduler,
              });
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
                preferences: await manager.listAgentPreferences(
                  msg.workspaceId,
                ),
              });
              break;

            case "saveAgentPreference":
              await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
              await manager.saveAgentPreference(
                msg.workspaceId,
                msg.preference,
              );
              await syncExecutorAgentPermissionCeiling(
                msg.workspaceId,
                await executorPermissionCeiling(msg.workspaceId),
              ).catch((error: Error) =>
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
                requestId: msg.requestId,
                preferences: await manager.listAgentPreferences(
                  msg.workspaceId,
                ),
              });
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
                const handleEvent = async (agentEvent: AgentEvent) => {
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
                    await manager.waitForChatPersistence(
                      msg.workspaceId,
                      chatId,
                    );
                    const messages = await manager.messages(
                      msg.workspaceId,
                      chatId,
                    );
                    const persisted =
                      agentEvent.type === "message" && agentEvent.id
                        ? messages.find(
                            (message) => message.id === agentEvent.id,
                          )
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
                const listener = (event: AgentEvent) => {
                  void handleEvent(event).catch(reportSessionEventError);
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
                agentId: inspected.session?.agent.id ?? inspected.chat.agent,
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
              await handleOpenChat({
                authorizeWorkspace,
                bindRootSession,
                browserKey,
                browserSession,
                chatDestinations,
                googleAccountSessions,
                googleAnalyticsOAuthBrowserPromptOptions,
                integrationSetups,
                manager,
                msg,
                onboardingBootstraps,
                pluginMcpServers: (workspaceId) =>
                  plugins.mcpServers(workspaceId),
                send,
              });
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
              await handleSendMessage({
                authorizeWorkspace,
                bindRootSession,
                broadcastChannelEvent,
                chatDestinations,
                ensureChiefSession,
                integrationSetups,
                manager,
                msg,
                pluginMcpServers: (workspaceId) =>
                  plugins.mcpServers(workspaceId),
                send,
              });
              break;
            }

            case "interruptChat":
              await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
              await manager.assertInteractiveChat(msg.workspaceId, msg.chatId);
              try {
                await (
                  await manager.inspectChat(msg.workspaceId, msg.chatId)
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
            case "listVercelEveDestinations": {
              await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
              const environment = await workspaceSecrets.readEnv(
                msg.workspaceId,
                ["VERCEL_TOKEN"],
              );
              const token = environment.VERCEL_TOKEN;
              if (!token) {
                throw new Error(
                  "Connect Vercel in Chief before choosing an Eve destination.",
                );
              }
              const catalog = await listVercelEveDestinations({
                token,
                ...(msg.teamId ? { teamId: msg.teamId } : undefined),
              });
              send({
                type: "vercelEveDestinations",
                workspaceId: msg.workspaceId,
                requestId: msg.requestId,
                catalog,
              });
              break;
            }
            case "provisionVercelEveAgent": {
              await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
              const environment = await workspaceSecrets.readEnv(
                msg.workspaceId,
                ["VERCEL_TOKEN"],
              );
              const token = environment.VERCEL_TOKEN;
              if (!token) {
                throw new Error(
                  "Connect Vercel in Chief before configuring this Eve deployment.",
                );
              }
              const result = await provisionVercelEveDeployment({
                token,
                input: msg.input,
                onProgress: (progress) =>
                  send({
                    type: "eveAgentProvisioningProgress",
                    workspaceId: msg.workspaceId,
                    requestId: msg.requestId,
                    progress,
                  }),
              });
              send({
                type: "eveAgentProvisioned",
                workspaceId: msg.workspaceId,
                requestId: msg.requestId,
                result,
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
                      ? {
                          displayName: googleAnalytics.connection.identityLabel,
                        }
                      : undefined),
                  },
                ],
              });
              break;
            }

            case "provideInput": {
              await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
              if (!msg.recurringWorkId) {
                await manager.assertInteractiveChat(
                  msg.workspaceId,
                  msg.chatId,
                );
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
                  throw new Error(
                    "Schedule does not own this private session.",
                  );
                }
              }
              if (!session || msg.recurringWorkId) {
                await manager.waitForChatPersistence(
                  msg.workspaceId,
                  msg.chatId,
                );
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
                      agentId: "chief",
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
              : undefined),
            chatId: "chatId" in msg ? msg.chatId : undefined,
            requestId: "requestId" in msg ? msg.requestId : undefined,
          });
        }
      })().catch((error: Error) => {
        console.error("[chief] websocket message failed:", error);
        send({ type: "error", message: safeRuntimeError(error) });
      });
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
