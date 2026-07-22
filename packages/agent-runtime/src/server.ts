/* eslint-disable max-lines */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import {
  AgentBrowserSession,
  lastUsedChromeProfile,
} from "@chief/browser/node";
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

import type { AgentSession } from "./session.js";
import type {
  AgentDeploymentRecord,
  AgentEvent,
  BrowserAutomationCommand,
  BrowserAutomationResult,
  ChatExecutionSelection,
  ClientMessage,
  DriverType,
  ExecutorCapability,
  InputRequest,
  IntegrationSetupProgress,
  RuntimeNotice,
  ServerMessage,
} from "./types.js";
import { AgentDeploymentManager } from "./agent-deployments.js";
import {
  composeWorkspaceInstructions,
  defaultAgents,
  getAgent,
} from "./agents.js";
import {
  availableCapabilities,
  composeAgentCapabilities,
} from "./capabilities/index.js";
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
import {
  googleOAuthAuthenticatedBrowserPrompt,
  googleOAuthInterruptedBrowserPrompt,
} from "./google-oauth-browser-prompt.js";
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
import { handleLocalTool, localToolsOpenApi } from "./local-tools.js";
import { SessionManager } from "./manager.js";
import { createChiefMcpHandler } from "./mcp-server.js";
import { listModels } from "./models.js";
import { planOnboardingWork } from "./onboarding-preflight.js";
import { nextRunAt, validateCron } from "./recurring-work.js";
import { resumeDriverBlockedWork } from "./scheduled-agent-config.js";
import { RecurringWorkScheduler } from "./scheduler.js";
import {
  awaitGoogleAnalyticsAuthorization,
  disconnectGoogleAnalyticsConnection,
  ensureExecutorWorkspace,
  executorHandoffUrl,
  inspectGoogleAnalyticsConfiguration,
  prepareIntegrationSetup,
  startGoogleAnalyticsAuthorization,
  storeGoogleAnalyticsOAuthClient,
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
    await storeGoogleAnalyticsOAuthClient(workspaceId, capability, {
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
  const manager = new SessionManager();
  const localCapabilities = new Map<
    string,
    { apiBaseUrl: string; verifiedAt: number; workspaceId: string }
  >();
  const workspaceCapabilities = new Map<string, ExecutorCapability>();
  const cloudSyncs = new Map<string, Promise<void>>();
  const onboardingBootstraps = new Map<
    string,
    { signature: string; promise: Promise<string> }
  >();
  const activeIntegrationSetups = new Map<
    string,
    Map<string, { attemptId: string; domain: string; expiresAt: number }>
  >();
  const integrationSetupDomains = new Map<string, Map<string, string>>();
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
  const browserSessions = new Map<string, AgentBrowserSession>();
  const browserViewportWaiters = new Map<
    string,
    (viewport?: { width: number; height: number }) => void
  >();
  const pendingBrowserViewports = new Map<
    string,
    { width: number; height: number }
  >();
  const browserViewportResizeTasks = new Map<string, Promise<void>>();
  const browserKey = (workspaceId: string, conversationId: string) =>
    `${workspaceId}\0${conversationId}`;
  const browserProfileSetting = process.env.CHIEF_BROWSER_PROFILE?.trim();
  const configuredBrowserProfile = browserProfileSetting?.length
    ? browserProfileSetting
    : undefined;
  const inheritedChromeProfile =
    configuredBrowserProfile === "none"
      ? undefined
      : (configuredBrowserProfile ?? lastUsedChromeProfile());
  const configuredBrowserExtensions = (
    process.env.CHIEF_BROWSER_EXTENSIONS ?? ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
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
  const browserSession = (workspaceId: string, conversationId: string) => {
    const key = browserKey(workspaceId, conversationId);
    const current = browserSessions.get(key);
    if (current) return current;
    const isGoogleSetup =
      integrationSetupDomains
        .get(workspaceId)
        ?.get(conversationId)
        ?.endsWith(".googleapis.com") === true;
    const session = new AgentBrowserSession({
      sessionId: `chief-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`,
      downloadPath: join(
        workspaceRoot(workspaceId),
        ".browser",
        createHash("sha256").update(conversationId).digest("hex").slice(0, 16),
        "downloads",
      ),
      executablePath: systemChrome,
      extensions: isGoogleSetup ? configuredBrowserExtensions : undefined,
      profile: isGoogleSetup ? inheritedChromeProfile : undefined,
      restore: false,
    });
    browserSessions.set(key, session);
    return session;
  };
  const resizeBrowserSession = (
    workspaceId: string,
    conversationId: string,
    viewport: { width: number; height: number },
  ) => {
    const key = browserKey(workspaceId, conversationId);
    pendingBrowserViewports.set(key, viewport);
    const current = browserViewportResizeTasks.get(key);
    if (current) return current;
    const task = (async () => {
      while (pendingBrowserViewports.has(key)) {
        const next = pendingBrowserViewports.get(key);
        pendingBrowserViewports.delete(key);
        if (next) {
          await browserSession(workspaceId, conversationId).setViewport(
            next.width,
            next.height,
          );
        }
      }
    })().finally(() => browserViewportResizeTasks.delete(key));
    browserViewportResizeTasks.set(key, task);
    return task;
  };
  const activeIntegrationSetup = (
    workspaceId: string,
    sessionId: string,
    attemptId: string,
  ) => {
    const setup = activeIntegrationSetups.get(workspaceId)?.get(sessionId);
    if (setup?.attemptId !== attemptId || setup.expiresAt <= Date.now()) {
      activeIntegrationSetups.get(workspaceId)?.delete(sessionId);
      throw new Error("This integration setup run is not active.");
    }
    return setup;
  };
  const assertActiveIntegrationSetup = (
    workspaceId: string,
    sessionId: string,
    attemptId: string,
    domain: string,
  ) => {
    const setup = activeIntegrationSetup(workspaceId, sessionId, attemptId);
    if (setup.domain !== domain) {
      throw new Error("This integration setup run targets another provider.");
    }
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
      workspaceCapabilities.set(workspaceId, {
        apiBaseUrl: cached.apiBaseUrl,
        token: capability.token,
      });
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
    workspaceCapabilities.set(workspaceId, {
      apiBaseUrl: verified.apiBaseUrl,
      token: capability.token,
    });
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
  let broadcastIntegrationSetupProgress = (
    _workspaceId: string,
    _conversationId: string,
    _progress: IntegrationSetupProgress,
  ) => undefined;
  const openBrowserSession = async (
    workspaceId: string,
    conversationId: string,
    url: string,
    viewport?: { width: number; height: number },
  ) => {
    const key = browserKey(workspaceId, conversationId);
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
    const initialViewport =
      viewport ??
      (await new Promise<{ width: number; height: number } | undefined>(
        (resolve) => {
          const timer = setTimeout(() => {
            browserViewportWaiters.delete(key);
            resolve(undefined);
          }, 750);
          browserViewportWaiters.set(key, (next) => {
            clearTimeout(timer);
            browserViewportWaiters.delete(key);
            resolve(next);
          });
          broadcastBrowserPrepare(workspaceId, conversationId, lockedUrl);
        },
      ));
    const session = browserSession(workspaceId, conversationId);
    const stream = await session.open(lockedUrl, initialViewport);
    const currentUrl = await session.getUrl().catch(() => lockedUrl);
    reportGoogleBrowserStep(workspaceId, conversationId, currentUrl);
    broadcastBrowserNavigate(
      workspaceId,
      conversationId,
      currentUrl,
      stream.url,
    );
    return session;
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
    if (command.type === "snapshot") {
      const snapshot = await session.snapshot();
      const isGoogleSetup =
        integrationSetupDomains
          .get(workspaceId)
          ?.get(conversationId)
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
        snapshot: {
          url: visibleUrl,
          title: snapshot.title,
          text: visibleSnapshot,
          controls: visibleSnapshot
            .split("\n")
            .filter((line) => line.includes("@e"))
            .slice(0, 300),
        },
      };
    }
    if (command.type === "click") {
      await session.click(command.labels);
      return { clicked: true };
    }
    if (command.type === "fill") {
      await session.fill(command.labels, command.value);
      return { filled: true };
    }
    await session.press(command.key);
    return { pressed: true };
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
    const current = manager.get(workspaceId, chatId);
    if (current) return current;
    const agent = getAgent("cmo");
    if (!agent) throw new Error("CMO persona is missing.");
    const preference = await manager.agentPreference(workspaceId, "cmo");
    if (!preference?.driver || preference.enabled === false) {
      throw new Error("Configure the CMO agent app before continuing work.");
    }
    const capableAgent = preference.capabilities
      ? composeAgentCapabilities(
          agent,
          availableCapabilities.filter((item) =>
            preference.capabilities?.includes(item.id),
          ),
        )
      : agent;
    const integratedAgent =
      preference.integrations !== undefined
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
        ? [executorToolServer(executorWorkspace)]
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
        await session.sendPrompt(receipt);
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
      integrationSetupDomains.get(workspaceId)?.get(sessionId) !==
      GOOGLE_ANALYTICS_DOMAIN
    ) {
      return;
    }
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return;
    }
    if (url.hostname !== "console.cloud.google.com") return;
    const service = googleAnalyticsRecipe.services.find((candidate) =>
      url.pathname.includes(`/apis/library/${candidate.service}`),
    );
    const progress: IntegrationSetupProgress | undefined = service
      ? {
          recipeId: "google-analytics",
          phase: "enable-api",
          service: service.name,
          instruction: `Chief is enabling ${service.name}…`,
          status: "active",
        }
      : url.pathname.startsWith("/auth/clients")
        ? {
            recipeId: "google-analytics",
            phase: "create-client",
            instruction: "Chief is creating the Desktop OAuth client…",
            status: "active",
          }
        : url.pathname.startsWith("/auth/")
          ? {
              recipeId: "google-analytics",
              phase: "auth-platform",
              instruction: "Chief is configuring Google Auth Platform…",
              status: "active",
            }
          : undefined;
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
    if (path.startsWith("/local-tools/")) {
      const authorization = req.headers.authorization ?? "";
      const token = /^Bearer (.+)$/.exec(authorization)?.[1];
      const cachedCapability = token ? localCapabilities.get(token) : undefined;
      const workspaceId = cachedCapability?.workspaceId;
      if (!workspaceId || !token) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      try {
        await authorizeWorkspace(workspaceId, {
          apiBaseUrl: cachedCapability.apiBaseUrl,
          token,
        });
      } catch {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Workspace authorization expired" }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk as Uint8Array));
      }
      const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
        method: req.method,
        headers: Object.fromEntries(
          Object.entries(req.headers).flatMap(([key, value]) =>
            typeof value === "string" ? [[key, value]] : [],
          ),
        ),
        ...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}),
      });
      const response = await handleLocalTool(request, workspaceId, manager, {
        onActivity: () => broadcastWorkspaceData(workspaceId),
        onFilesChanged: () => broadcastWorkspaceFiles(workspaceId),
        openBrowser: async (conversationId, url) => {
          await manager.rootChat(workspaceId, conversationId);
          await openBrowserSession(workspaceId, conversationId, url);
        },
        browserCommand: async (conversationId, command) => {
          await manager.rootChat(workspaceId, conversationId);
          return requestBrowserCommand(workspaceId, conversationId, command);
        },
        activateIntegrationSetup: async (sessionId, attemptId, domain) => {
          await prepareIntegrationSetup(
            workspaceId,
            { apiBaseUrl: cachedCapability.apiBaseUrl, token },
            domain,
          );
          const domains =
            integrationSetupDomains.get(workspaceId) ??
            new Map<string, string>();
          domains.set(sessionId, domain);
          integrationSetupDomains.set(workspaceId, domains);
          const active =
            activeIntegrationSetups.get(workspaceId) ??
            new Map<
              string,
              { attemptId: string; domain: string; expiresAt: number }
            >();
          active.set(sessionId, {
            attemptId,
            domain,
            expiresAt: Date.now() + 30 * 60_000,
          });
          activeIntegrationSetups.set(workspaceId, active);
        },
        openIntegrationHandoff: async (sessionId, attemptId, url) => {
          activeIntegrationSetup(workspaceId, sessionId, attemptId);
          const handoffUrl = await executorHandoffUrl(workspaceId, url);
          await openBrowserSession(workspaceId, sessionId, handoffUrl);
        },
        googleOAuth: {
          provisionClient: async (sessionId, attemptId) => {
            const setup = activeIntegrationSetup(
              workspaceId,
              sessionId,
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
            pendingGoogleAuthentication.set(`${workspaceId}\0${sessionId}`, {
              attemptId,
              capability: {
                apiBaseUrl: cachedCapability.apiBaseUrl,
                token,
              },
            });
            broadcastIntegrationSetupProgress(workspaceId, sessionId, {
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
              sessionId,
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
            await storeGoogleAnalyticsOAuthClient(
              workspaceId,
              { apiBaseUrl: cachedCapability.apiBaseUrl, token },
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
                apiBaseUrl: cachedCapability.apiBaseUrl,
                token,
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
            if (clientId && clientSecret) {
              await workspaceSecrets.deleteEnv(
                workspaceId,
                "GOOGLE_ANALYTICS_CLIENT_ID",
              );
              await workspaceSecrets.deleteEnv(
                workspaceId,
                "GOOGLE_ANALYTICS_CLIENT_SECRET",
              );
            }
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
              apiBaseUrl: cachedCapability.apiBaseUrl,
              token,
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
            activeIntegrationSetups.get(workspaceId)?.delete(sessionId);
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
              apiBaseUrl: cachedCapability.apiBaseUrl,
              token,
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
            activeIntegrationSetups.get(workspaceId)?.delete(sessionId);
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
  const http4 = createServer((req, res) => void handler(req, res));
  const http6 = createServer((req, res) => void handler(req, res));
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
  broadcastBrowserNavigate = (workspaceId, conversationId, url, streamUrl) => {
    const message = JSON.stringify({
      type: "browserNavigate",
      workspaceId,
      conversationId,
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
    const message = JSON.stringify({
      type: "browserPrepare",
      workspaceId,
      conversationId,
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
        if (agentEvent.type !== "message") {
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
        if (
          agentEvent.type === "result" ||
          agentEvent.type === "error" ||
          agentEvent.type === "exit"
        ) {
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
          msg.type === "browserViewportResize" ||
          msg.type === "browserUrlChanged"
        ) {
          if (!socketAuthorization.canReceive(ws, msg.workspaceId)) {
            throw new Error("This browser action is not authorized.");
          }
          if (msg.type === "browserUrlChanged") {
            const url = new URL(msg.url);
            if (url.protocol !== "http:" && url.protocol !== "https:") {
              throw new Error("Browser URLs must use HTTP or HTTPS.");
            }
            const key = browserKey(msg.workspaceId, msg.conversationId);
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
              const key = browserKey(msg.workspaceId, msg.conversationId);
              const waiter = browserViewportWaiters.get(key);
              if (waiter) waiter({ width: msg.width, height: msg.height });
              else {
                await resizeBrowserSession(
                  msg.workspaceId,
                  msg.conversationId,
                  { width: msg.width, height: msg.height },
                );
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
            const chatId = `workspace-kickoff-${createHash("sha256")
              .update(msg.workspaceId)
              .digest("hex")
              .slice(0, 32)}`;
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
            let bootstrap = activeBootstrap?.promise;
            if (!bootstrap) {
              bootstrap = (async () => {
                console.log(
                  `[chief] preparing initial business review for ${msg.workspaceId}`,
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
                    "Choose a CMO agent app before starting the initial business review.",
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

                const onboardingDirectory = join(
                  workspaceRoot(msg.workspaceId),
                  "onboarding",
                );
                mkdirSync(onboardingDirectory, {
                  recursive: true,
                  mode: 0o700,
                });
                const hasGoogleAnalyticsSetup = msg.jobs.some(
                  (job) =>
                    job.agentId === "setup" &&
                    job.setupDomain === GOOGLE_ANALYTICS_DOMAIN,
                );
                const googleAnalyticsConfiguration = hasGoogleAnalyticsSetup
                  ? await inspectGoogleAnalyticsConfiguration(
                      msg.workspaceId,
                      msg.executorCapability,
                    ).catch((error: unknown) => {
                      console.error(
                        "[onboarding] Google Analytics preflight failed:",
                        error,
                      );
                      return undefined;
                    })
                  : undefined;
                const onboardingPlan = planOnboardingWork(
                  msg.jobs,
                  googleAnalyticsConfiguration
                    ? Boolean(googleAnalyticsConfiguration.connection)
                    : undefined,
                );
                const attachmentPaths: string[][] = [];
                let totalBytes = 0;
                for (const [jobIndex, job] of msg.jobs.entries()) {
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
                      onboardingDirectory,
                      `${jobIndex + 1}-${attachmentIndex + 1}-${safeName || "attachment"}`,
                    );
                    writeFileSync(path, bytes, { mode: 0o600 });
                    saved.push(path);
                  }
                  attachmentPaths[jobIndex] = saved;
                }

                const jobs = onboardingPlan.launchableJobs.map((job) => {
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
                const kickoffPrompt = [
                  "Own one coherent initial business review. Keep this conversation as its single user-visible home and own the final synthesis.",
                  "In the first execution pass, launch every independent job concurrently: Brand Researcher, every selected Setup job, and Prospector. Issue all of those delegation tool calls before waiting for or polling any child. Only the Analyst is dependency-gated on a verified analytics connection.",
                  onboardingPlan.launchableJobs.some(
                    (job) => job.agentId === "brand",
                  )
                    ? driver === "remote"
                      ? "Launch business and brand research exactly once through the declared Brand Researcher in the initial parallel batch. Never start an equivalent second Brand Researcher. Verify its result when available, then save the complete Markdown through chief files.save at brand/working-brand-profile.md so it is durable and visible. If Brand fails, continue every other job and synthesize with a clearly labeled provisional brand gap."
                      : "Launch business and brand research exactly once through localTools.specialistsDelegate in the initial parallel batch. Omit waitSeconds so the child continues in the background. A working response is healthy; reuse one stable delegation ID, never start an equivalent second Brand Researcher, and use its automatically saved versioned brand-profile file when available. If Brand fails, do not retry or stop the review: continue every other job and synthesize with a clearly labeled provisional brand gap."
                    : "The user skipped brand research. Use the supplied workspace context without creating a Brand Researcher delegation.",
                  onboardingPlan.launchableJobs.some(
                    (job) => job.agentId === "setup",
                  )
                    ? driver === "remote"
                      ? "Launch every listed Setup job independently through the declared Setup subagent in the initial parallel batch. Do not wait for Brand or serialize unrelated providers."
                      : "Launch every listed Setup job independently through localTools.specialistsDelegate in the initial parallel batch and omit waitSeconds. Copy each job's setupDomain and setupAttemptId into its matching tool fields. Do not wait for Brand or serialize unrelated providers. Setup may open a provider consent screen; if it returns a genuine user-only credential, consent, or account choice, raise one precise provider-scoped action while all unrelated work continues."
                    : "No integration setup was selected during onboarding.",
                  onboardingPlan.launchableJobs.some(
                    (job) => job.agentId === "analyst",
                  )
                    ? "As soon as an analytics Setup job is verified connected, launch the listed Analyst job. This is the only dependent kickoff job. Require its saved local dataset and chart before including analytics in the synthesis; if setup is genuinely blocked, do not fabricate a report or hold up unrelated results."
                    : "No initial analytics report was requested.",
                  onboardingPlan.deferredGoogleAnalytics
                    ? "Google Analytics Setup and the initial Analyst report are deferred before any child attempt because the required Google OAuth client is predictably absent. Chief has already created one deterministic Overview action with exact Google Cloud instructions and secure fields. Setup will run in its own user-visible conversation. Do not delegate Google Analytics Setup, create another credential action, or poll for credentials; continue all launchable work until Chief sends a verified-connection continuation."
                    : "No onboarding work was deferred by credential preflight.",
                  driver === "remote"
                    ? "Launch initial prospecting exactly once through the declared Prospector in the initial parallel batch. Require five to eight recent, high-confidence results with direct source URLs and require every qualified result to be saved through chief prospects.save before returning. Never start an equivalent second Prospector."
                    : "Launch initial prospecting exactly once through localTools.specialistsDelegate in the initial parallel batch and omit waitSeconds. Require five to eight recent, high-confidence results with direct source URLs and require the Prospector to save every qualified result with prospectsSave before returning. A working response means it continues in the background; never start an equivalent second Prospector.",
                  "After every independent child is underway, inspect workspace context and prepare the recurring work and review structure while children run. Then reconcile each stable delegation ID. Do not repeatedly poll one child while another initial job has not been launched. A failed independent child is a labeled gap, never a reason to abandon or withhold all other results. Final synthesis may wait for healthy research results, but must not wait for failed work or a Setup job blocked on user action.",
                  "Inspect workspace context and already-connected Chief sources before asking the user for anything. Treat the underlying connection service as an internal implementation detail.",
                  "Initial jobs:",
                  jobs.length > 0 ? jobs.join("\n") : "- None selected.",
                  "Recurring schedule plan:",
                  schedules.length > 0
                    ? schedules.join("\n")
                    : "- No recurring schedules selected.",
                  "Launch the concurrent kickoff now. Save the complete initial business review as a versioned Markdown workspace file under reviews/ and include it in the final synthesis. A blocked integration must not erase or delay completed brand or prospecting work.",
                ].join("\n\n");

                await manager.createRootChat(
                  msg.workspaceId,
                  chatId,
                  "Initial business review",
                  driver,
                  model,
                );
                if (onboardingPlan.deferredGoogleAnalytics) {
                  await manager.raiseActionItem(msg.workspaceId, {
                    id: `onboarding-google-analytics-${createHash("sha256")
                      .update(msg.workspaceId)
                      .digest("hex")
                      .slice(0, 24)}`,
                    agentId: "setup",
                    title: "Connect Google Analytics",
                    reason:
                      "Google Analytics was selected during onboarding. Open Setup and sign in with the Google account that administers the Analytics property you want Chief to use.",
                    sourceId: chatId,
                    status: "open",
                    createdAt: now,
                  });
                }
                let persistedMessages = await manager.transcript(
                  msg.workspaceId,
                  chatId,
                );
                const kickoffId = `${chatId}-kickoff`;
                if (
                  !persistedMessages.some(
                    (event) =>
                      event.type === "message" &&
                      event.role === "user" &&
                      event.id === kickoffId,
                  )
                ) {
                  await manager.saveTranscript(
                    {
                      id: chatId,
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
                        content: [{ type: "text", text: kickoffPrompt }],
                      },
                    ],
                    "Initial business review",
                  );
                  persistedMessages = await manager.transcript(
                    msg.workspaceId,
                    chatId,
                  );
                  await broadcastWorkspaceData(msg.workspaceId);
                }

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

                const agent = getAgent("cmo");
                if (!agent) throw new Error("CMO persona is missing.");
                const preference = await manager.agentPreference(
                  msg.workspaceId,
                  "cmo",
                );
                const capabilities = preference?.capabilities;
                const capableAgent = capabilities
                  ? composeAgentCapabilities(
                      agent,
                      availableCapabilities.filter((capability) =>
                        capabilities.includes(capability.id),
                      ),
                    )
                  : agent;
                const integratedAgent =
                  preference?.integrations !== undefined
                    ? {
                        ...capableAgent,
                        instructions: `${capableAgent.instructions}\n\nAssigned integrations: ${preference.integrations.length > 0 ? preference.integrations.join(", ") : "none"}. Only search for and call integration tools from this assigned set.`,
                      }
                    : capableAgent;
                const effectiveAgent = {
                  ...integratedAgent,
                  instructions: composeWorkspaceInstructions(
                    integratedAgent.instructions,
                    readWorkspaceContext(msg.workspaceId),
                  ),
                };
                const executorWorkspace = await ensureExecutorWorkspace(
                  msg.workspaceId,
                  msg.executorCapability,
                );
                const session = await manager.ensureRootChat(
                  effectiveAgent,
                  chatId,
                  {
                    driver,
                    access: "full",
                    workspaceId: msg.workspaceId,
                    model: preference?.model,
                    mcpServers: [executorToolServer(executorWorkspace)],
                    executionOwner: "interactive",
                  },
                  "Initial business review",
                );
                await manager.waitForChatPersistence(msg.workspaceId, chatId);
                if (
                  !persistedMessages.some(
                    (event) =>
                      (event.type === "message" &&
                        event.role === "assistant") ||
                      (event.type === "result" && event.ok),
                  )
                ) {
                  const releaseExecution = manager.acquireExecution(
                    msg.workspaceId,
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
                      session.off("event", broadcastOnActivity);
                      releaseExecution();
                    }
                  };
                  session.on("event", releaseOnTerminal);
                  const broadcastOnActivity = (event: AgentEvent) => {
                    if (
                      event.type === "status" ||
                      event.type === "result" ||
                      event.type === "error" ||
                      event.type === "exit"
                    ) {
                      void broadcastWorkspaceData(msg.workspaceId);
                    }
                  };
                  session.on("event", broadcastOnActivity);
                  try {
                    await session.sendPrompt(kickoffPrompt, undefined, false);
                    await manager.waitForChatPersistence(
                      msg.workspaceId,
                      chatId,
                    );
                  } catch (error) {
                    session.off("event", releaseOnTerminal);
                    session.off("event", broadcastOnActivity);
                    releaseExecution();
                    throw error;
                  }
                }
                await broadcastWorkspaceData(msg.workspaceId);
                return chatId;
              })();
              onboardingBootstraps.set(msg.workspaceId, {
                signature,
                promise: bootstrap,
              });
            }
            try {
              await bootstrap;
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
                `[chief] initial business review started for ${msg.workspaceId}`,
              );
            } finally {
              if (
                onboardingBootstraps.get(msg.workspaceId)?.promise === bootstrap
              ) {
                onboardingBootstraps.delete(msg.workspaceId);
              }
            }
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
              await prepareIntegrationSetup(
                msg.workspaceId,
                msg.executorCapability,
                GOOGLE_ANALYTICS_DOMAIN,
              );
              const domains =
                integrationSetupDomains.get(msg.workspaceId) ??
                new Map<string, string>();
              domains.set(msg.setup.chatId, GOOGLE_ANALYTICS_DOMAIN);
              integrationSetupDomains.set(msg.workspaceId, domains);
              const active =
                activeIntegrationSetups.get(msg.workspaceId) ??
                new Map<
                  string,
                  { attemptId: string; domain: string; expiresAt: number }
                >();
              active.set(msg.setup.chatId, {
                attemptId: deferredGoogleAnalyticsAttempt,
                domain: GOOGLE_ANALYTICS_DOMAIN,
                expiresAt: Date.now() + 30 * 60_000,
              });
              activeIntegrationSetups.set(msg.workspaceId, active);
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
              ? onboardingBootstraps.get(msg.workspaceId)?.promise
              : undefined;
            if (onboardingBootstrap) await onboardingBootstrap;
            await manager.assertInteractiveChat(msg.workspaceId, msg.chatId);
            const agentId =
              msg.purpose === "integration-setup"
                ? "setup"
                : msg.purpose === "analytics-report"
                  ? "analyst"
                  : "cmo";
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
            if (msg.purpose === "integration-setup") {
              await prepareIntegrationSetup(
                msg.workspaceId,
                msg.executorCapability,
                msg.integrationDomain ?? "",
              );
            }
            const storedChat = await manager.createRootChat(
              msg.workspaceId,
              msg.chatId,
              msg.purpose === "integration-setup"
                ? msg.integrationDomain === GOOGLE_ANALYTICS_DOMAIN
                  ? "Google Analytics setup"
                  : "Integration setup"
                : "",
              requestedExecution?.driver,
              requestedExecution?.model,
              agentId,
            );
            let setupAttemptId: string | null = null;
            if (msg.purpose === "integration-setup") {
              const domains =
                integrationSetupDomains.get(msg.workspaceId) ??
                new Map<string, string>();
              domains.set(msg.chatId, msg.integrationDomain ?? "");
              integrationSetupDomains.set(msg.workspaceId, domains);
              setupAttemptId = activeSetupAttempt(
                await manager.transcript(msg.workspaceId, msg.chatId),
              );
              if (setupAttemptId) {
                const active =
                  activeIntegrationSetups.get(msg.workspaceId) ??
                  new Map<
                    string,
                    { attemptId: string; domain: string; expiresAt: number }
                  >();
                active.set(msg.chatId, {
                  attemptId: setupAttemptId,
                  domain: msg.integrationDomain ?? "",
                  expiresAt: Date.now() + 30 * 60_000,
                });
                activeIntegrationSetups.set(msg.workspaceId, active);
              } else {
                activeIntegrationSetups
                  .get(msg.workspaceId)
                  ?.delete(msg.chatId);
              }
            }
            if (
              !storedChat ||
              !DRIVER_TYPES.has(storedChat.provider as DriverType)
            ) {
              throw new Error("This chat has an unsupported agent app.");
            }
            const driver =
              requestedExecution?.driver ?? (storedChat.provider as DriverType);
            const model = requestedExecution
              ? requestedExecution.model
              : storedChat.model;
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
            if (
              msg.chatId.startsWith("workspace-kickoff-") &&
              !onboardingBootstrap
            ) {
              const events = await manager.transcript(
                msg.workspaceId,
                msg.chatId,
              );
              const reviewProducedOutput = events.some(
                (event) =>
                  (event.type === "message" && event.role === "assistant") ||
                  (event.type === "result" && event.ok),
              );
              if (!reviewProducedOutput) {
                recoveryPrompt = [
                  "Resume the initial business review for this workspace.",
                  driver === "remote"
                    ? "Use current workspace context and connected cloud sources. Launch Brand Researcher and Prospector concurrently and exactly once through Eve's declared subagents before waiting for either. Persist the brand profile and full review through chief files.save, and persist five to eight qualified prospects with direct source URLs through chief prospects.save."
                    : "Use the current workspace context and connected sources. Launch Brand Researcher and Prospector concurrently and exactly once with localTools.specialistsDelegate, omitting waitSeconds so both continue in the background. Save the verified brand Markdown with localTools.brandProfileSave and retain its visible versioned file. Require Prospector to persist five to eight qualified results with direct source URLs through prospectsSave. Reuse stable delegation IDs and never start equivalent duplicate specialists.",
                  driver === "remote"
                    ? "If workspace context names an unconnected analytics or advertising source, do not delegate setup. Persist one direct provider-specific connection action through chief actions.raise."
                    : "If workspace context names an unconnected analytics or advertising source, do not delegate setup. Create one direct provider-specific connection action.",
                  "Reconcile every analytics and advertising provider chosen in workspace context against connected sources. Create one exact setup action for each genuinely unconnected provider after useful work is complete. If AI referral tracking is enabled, include an attributable AI-referral measurement plan and any honest instrumentation gap.",
                  "Do not ask the user for information Chief can discover. If authorization is genuinely required, complete everything else and create one distinct action per provider or user decision, with a provider-scoped stable dedupe key.",
                  "Missing integrations are non-blocking. Complete and save all public-source, brand, and prospecting work first. Save the complete review as a versioned Markdown file under reviews/, include the document in the synthesis, then create only deduplicated structured setup actions with stable keys. Recording actions is not completion.",
                ].join("\n\n");
                const kickoffId = `${msg.chatId}-kickoff`;
                if (
                  !events.some(
                    (event) =>
                      event.type === "message" &&
                      event.role === "user" &&
                      event.id === kickoffId,
                  )
                ) {
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
                  const effectiveAgent = {
                    ...integratedAgent,
                    instructions: composeWorkspaceInstructions(
                      msg.purpose === "integration-setup"
                        ? `${integratedAgent.instructions}\n\nThis is a user-started integration setup run. Perform the setup directly. Do not delegate to another agent. Finish all safe local setup and verification yourself, and ask only for information that cannot be discovered.`
                        : integratedAgent.instructions,
                      workspaceContext,
                    ),
                  };
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
                  event.type === "exit"
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
            const { session: openedSession } = await manager.rootChat(
              msg.workspaceId,
              msg.chatId,
            );
            if (!openedSession) {
              return send({
                type: "error",
                message:
                  "No session for this chat yet. Reopen it to reconnect.",
                chatId: msg.chatId,
              });
            }
            const releaseExecution = manager.acquireExecution(
              msg.workspaceId,
              msg.chatId,
              "interactive",
            );
            let session = openedSession;
            let releaseOnTerminal: ((event: AgentEvent) => void) | undefined;
            try {
              const firstLine = msg.text.split("\n", 1)[0] ?? "";
              if (
                firstLine.startsWith(SETUP_ATTEMPT_PREFIX) &&
                firstLine.endsWith("]")
              ) {
                const domain = integrationSetupDomains
                  .get(msg.workspaceId)
                  ?.get(msg.chatId);
                const attemptId = firstLine.slice(
                  SETUP_ATTEMPT_PREFIX.length,
                  -1,
                );
                if (domain && attemptId) {
                  const active =
                    activeIntegrationSetups.get(msg.workspaceId) ??
                    new Map<
                      string,
                      { attemptId: string; domain: string; expiresAt: number }
                    >();
                  active.set(msg.chatId, {
                    attemptId,
                    domain,
                    expiresAt: Date.now() + 30 * 60_000,
                  });
                  activeIntegrationSetups.set(msg.workspaceId, active);
                }
              }
              const execution = normalizedExecution(msg.execution);
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
                  releaseExecution();
                }
              };
              session.on("event", releaseOnTerminal);
              await session.sendPrompt(msg.text, msg.messageId);
            } catch (error) {
              if (releaseOnTerminal) {
                session.off("event", releaseOnTerminal);
              }
              releaseExecution();
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
    wss.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  return wss;
}

startServer();
