import type { AgentBrowserSession } from "@chief/browser/node";
import { googleAuthUserFromUrl } from "@chief/google-oauth-connector";

import type { IntegrationSetupRegistry } from "./integration-setup-state.js";
import type { SessionManager } from "./manager.js";
import type { AgentSession } from "./session.js";
import type {
  AgentEvent,
  ClientMessage,
  DriverType,
  ExecutorCapability,
  ServerMessage,
} from "./types.js";
import { getAgent } from "./agents.js";
import {
  availableCapabilities,
  composeAgentCapabilities,
} from "./capabilities/index.js";
import * as channelBridge from "./channels/server-bridge.js";
import { googleOAuthInterruptedBrowserPrompt } from "./google-oauth-browser-prompt.js";
import { GOOGLE_ANALYTICS_DOMAIN } from "./integration-requests.js";
import {
  onboardingKickoffId,
  onboardingKickoffProgress,
  onboardingOpeningIsVisible,
  onboardingRecoveryPrompt,
} from "./onboarding-kickoff.js";
import {
  activeSetupAttempt,
  chatControlEvents,
  normalizedExecution,
} from "./server-message-helpers.js";
import {
  ensureExecutorWorkspace,
  prepareIntegrationSetup,
} from "./tools/control-plane.js";
import { executorToolServer } from "./tools/spec.js";
import {
  readWorkspaceContext,
  writeWorkspaceContext,
} from "./workspace-context.js";
import { readWorkspaceWaysOfWorking } from "./workspace-ways-of-working.js";

type Message = Extract<ClientMessage, { type: "openChat" }>;
const DRIVER_TYPES = new Set<DriverType>(["codex", "opencode", "remote"]);

/** Opening a timeline reuses non-interactive work instead of taking its lane. */
export function shouldReuseLiveSessionOnOpen(
  session: AgentSession | undefined,
  claimedOwner?: "interactive" | "schedule" | "channel",
): session is AgentSession {
  return Boolean(
    session &&
    (session.isBusy ||
      session.config.executionOwner !== "interactive" ||
      (claimedOwner !== undefined && claimedOwner !== "interactive")),
  );
}

/** An onboarding channel is identified by its durable kickoff message, not by
 * a legacy chat-id prefix. Mission-control chats use ordinary channel IDs. */
export function shouldRecoverOnboardingOnOpen(
  events: readonly AgentEvent[],
  chatId: string,
) {
  const kickoff = onboardingKickoffProgress(
    events,
    onboardingKickoffId(chatId),
  );
  return kickoff.started && !kickoff.completed;
}

export async function handleOpenChat({
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
  send,
}: {
  authorizeWorkspace: (
    workspaceId: string,
    capability: Message["executorCapability"],
  ) => Promise<unknown>;
  bindRootSession: (
    workspaceId: string,
    chatId: string,
    session: AgentSession,
  ) => void;
  browserKey: (workspaceId: string, conversationId: string) => string;
  browserSession: (
    workspaceId: string,
    conversationId: string,
  ) => AgentBrowserSession;
  chatDestinations: Map<string, string>;
  googleAccountSessions: Map<
    string,
    {
      authuser?: string;
      awaitingSelection: boolean;
      attemptId?: string;
      capability?: ExecutorCapability;
    }
  >;
  googleAnalyticsOAuthBrowserPromptOptions: Parameters<
    typeof googleOAuthInterruptedBrowserPrompt
  >[0];
  integrationSetups: IntegrationSetupRegistry;
  manager: SessionManager;
  msg: Message;
  onboardingBootstraps: Map<string, { ready: Promise<string> }>;
  send: (message: ServerMessage) => void;
}) {
  await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
  const onboardingBootstrap = msg.chatId.startsWith("workspace-kickoff-")
    ? onboardingBootstraps.get(msg.workspaceId)?.ready
    : undefined;
  if (onboardingBootstrap) await onboardingBootstrap;
  const agentId =
    msg.purpose === "integration-setup"
      ? "setup"
      : msg.purpose === "analytics-report"
        ? "analyst"
        : (msg.agentId ?? "chief");
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`${agentId} persona is missing.`);
  const preference =
    (await manager.agentPreference(
      msg.workspaceId,
      agentId === "setup" ? "chief" : agentId,
    )) ??
    (agentId === "analyst"
      ? await manager.agentPreference(msg.workspaceId, "chief")
      : undefined);
  if (preference?.enabled === false) {
    throw new Error("Configure Chief's agent app before opening chat.");
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
    chatDestinations.set(`${msg.workspaceId}\0${msg.chatId}`, destinationId);
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
        recipeId: preparedSetup?.recipeId ?? msg.integrationDomain ?? "",
      });
    } else {
      integrationSetups.remove(msg.workspaceId, msg.chatId);
    }
  }
  if (!storedChat || !DRIVER_TYPES.has(storedChat.provider as DriverType)) {
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
    const visibleUrl = await browserSession(msg.workspaceId, msg.chatId)
      .getUrl()
      .catch(() => "");
    try {
      const page = new URL(visibleUrl);
      restartInterruptedSetup = page.hostname === "console.cloud.google.com";
    } catch {
      restartInterruptedSetup = false;
    }
    if (restartInterruptedSetup) {
      const authuser = googleAuthUserFromUrl(visibleUrl);
      if (authuser) {
        googleAccountSessions.set(browserKey(msg.workspaceId, msg.chatId), {
          authuser,
          awaitingSelection: false,
          attemptId: setupAttemptId,
          capability: msg.executorCapability,
        });
      }
      recoveryPrompt = googleOAuthInterruptedBrowserPrompt({
        ...googleAnalyticsOAuthBrowserPromptOptions,
        lockedAuthUser: authuser ?? undefined,
      });
    }
  }
  const onboardingEvents = await manager.transcript(
    msg.workspaceId,
    msg.chatId,
  );
  if (
    msg.chatId.startsWith("workspace-kickoff-") ||
    shouldRecoverOnboardingOnOpen(onboardingEvents, msg.chatId)
  ) {
    const events = onboardingEvents;
    const kickoffId = onboardingKickoffId(msg.chatId);
    const kickoff = onboardingKickoffProgress(events, kickoffId);
    if (!kickoff.completed) {
      recoveryPrompt = onboardingRecoveryPrompt(
        driver,
        !onboardingOpeningIsVisible(events, kickoffId),
        readWorkspaceWaysOfWorking(msg.workspaceId).missionControlChannelId,
      );
      if (!kickoff.started) {
        await manager.saveTranscript(
          {
            id: msg.chatId,
            organizationId: msg.workspaceId,
            agentId: "chief",
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
  let runningSession = manager.get(msg.workspaceId, msg.chatId);
  const claimedOwner = manager.executionOwner(msg.workspaceId, msg.chatId);
  if (!runningSession && claimedOwner && claimedOwner !== "interactive") {
    const deadline = Date.now() + 500;
    while (!runningSession && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      runningSession = manager.get(msg.workspaceId, msg.chatId);
    }
  }
  if (!runningSession && claimedOwner && claimedOwner !== "interactive") {
    send({
      type: "chatOpened",
      workspaceId: msg.workspaceId,
      chatId: msg.chatId,
      visibility: "user",
      execution: { driver, model },
    });
    const events = await manager.transcript(msg.workspaceId, msg.chatId);
    send({
      type: "history",
      workspaceId: msg.workspaceId,
      chatId: msg.chatId,
      messages: await manager.messages(msg.workspaceId, msg.chatId),
      events: chatControlEvents(events),
      running: true,
    });
    return;
  }
  const session = shouldReuseLiveSessionOnOpen(runningSession, claimedOwner)
    ? runningSession
    : await (async () => {
        await manager.assertInteractiveChat(msg.workspaceId, msg.chatId);
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
          msg.workspaceContext ?? readWorkspaceContext(msg.workspaceId);
        if (msg.workspaceContext) {
          writeWorkspaceContext(msg.workspaceId, msg.workspaceContext);
        }
        const effectiveAgent = channelBridge.agentForChannel(
          integratedAgent,
          msg.purpose,
          channel,
          workspaceContext,
          readWorkspaceWaysOfWorking(msg.workspaceId).missionControlChannelId,
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
                  msg.access === "full" && msg.purpose !== "integration-setup"
                    ? "model"
                    : "browser",
                ),
              ]
            : [],
          executionOwner: "interactive",
        } as const;
        return storedChat.provider !== driver || storedChat.model !== model
          ? manager.switchRootChatExecution(effectiveAgent, msg.chatId, config)
          : restartInterruptedSetup
            ? manager.restartRootChatContinuation(
                effectiveAgent,
                msg.chatId,
                config,
              )
            : manager.ensureRootChat(effectiveAgent, msg.chatId, config);
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
}
