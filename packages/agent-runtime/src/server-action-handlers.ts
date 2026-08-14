import type { IntegrationSetupRegistry } from "./integration-setup-state.js";
import type { SessionManager } from "./manager.js";
import type { RecurringWorkScheduler } from "./scheduler.js";
import type { AgentSession } from "./session.js";
import type { AgentEvent, ClientMessage, ServerMessage } from "./types.js";
import {
  GOOGLE_ANALYTICS_DOMAIN,
  GOOGLE_ANALYTICS_SETUP_TASK,
  googleAnalyticsActionChatId,
  googleAnalyticsOnboardingAttempt,
} from "./integration-requests.js";
import { nextRunAt } from "./recurring-work.js";
import {
  activeSetupAttempt,
  isGoogleAnalyticsOAuthRequest,
  storeInputValues,
} from "./server-message-helpers.js";
import { prepareIntegrationSetup } from "./tools/control-plane.js";

type ResolveMessage = Extract<ClientMessage, { type: "resolveActionRequest" }>;
type ExpandMessage = Extract<
  ClientMessage,
  { type: "expandRecurringWorkGrant" }
>;
type Authorize<M extends ResolveMessage | ExpandMessage> = (
  workspaceId: string,
  capability: M["executorCapability"],
) => Promise<unknown>;

export async function handleResolveActionRequest({
  authorizeWorkspace,
  broadcastWorkspaceData,
  continueChiefSession,
  dismissCloudAction,
  integrationSetups,
  manager,
  msg,
  send,
}: {
  authorizeWorkspace: Authorize<ResolveMessage>;
  broadcastWorkspaceData: (workspaceId: string) => Promise<void>;
  continueChiefSession: (
    workspaceId: string,
    chatId: string,
    prompt: string,
    capability: ResolveMessage["executorCapability"],
    threadRootId?: string,
  ) => Promise<void>;
  dismissCloudAction: (workspaceId: string, actionId: string) => Promise<void>;
  integrationSetups: IntegrationSetupRegistry;
  manager: SessionManager;
  msg: ResolveMessage;
  send: (message: ServerMessage) => void;
}) {
  await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
  const action = await manager.actionItem(msg.workspaceId, msg.actionItemId);
  if (action?.status !== "open" || action.request?.id !== msg.requestId) {
    throw new Error("This action request is no longer available.");
  }
  const questionKeys = new Set(
    (action.request.questions ?? []).map((question) => question.question),
  );
  const fieldKeys = new Set(action.request.fields.map((field) => field.key));
  if (
    !msg.resolvedBy.id.trim() ||
    !msg.resolvedBy.name.trim() ||
    Object.keys(msg.answers).some((key) => !questionKeys.has(key)) ||
    Object.keys(msg.values).some((key) => !fieldKeys.has(key)) ||
    [...questionKeys].some((key) => !(msg.answers[key] ?? "").trim()) ||
    [...fieldKeys].some((key) => !(msg.values[key] ?? ""))
  ) {
    throw new Error("The submitted action response is incomplete.");
  }
  const directGoogleSetup = isGoogleAnalyticsOAuthRequest(action.request);
  const deferredGoogleAnalyticsAttempt = googleAnalyticsOnboardingAttempt(
    action.request.id,
  );
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
      throw new Error("This Setup conversation does not match the action.");
    }
    const setupChat = await manager.rootChat(msg.workspaceId, msg.setup.chatId);
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
    return;
  }
  const receipt = [
    `The user resolved the action: ${action.title}`,
    ...Object.entries(msg.answers).map(
      ([question, answer]) => `- ${question}: ${answer.trim()}`,
    ),
    ...saved.map((destination) => `- Saved input to ${destination}`),
    "Continue the setup or review now using these answers. This is explicit authorization to run the supported local integration setup and open its browser consent flow. Never expose stored credential values, and complete every remaining independent part.",
  ].join("\n");
  const resolvedAction = {
    ...action,
    status: "resolved" as const,
    resolution: {
      answers: Object.fromEntries(
        Object.entries(msg.answers).map(([question, answer]) => [
          question,
          answer.trim(),
        ]),
      ),
      resolvedAt: Date.now(),
      resolvedBy: {
        id: msg.resolvedBy.id.trim(),
        name: msg.resolvedBy.name.trim(),
      },
    },
  };
  await manager.raiseActionItem(msg.workspaceId, resolvedAction);
  await dismissCloudAction(msg.workspaceId, action.id);
  send({
    type: "actionRequestResolved",
    workspaceId: msg.workspaceId,
    actionItemId: action.id,
    requestId: msg.requestId,
    action: resolvedAction,
  });
  await broadcastWorkspaceData(msg.workspaceId);
  const sourceId = action.sourceId;
  if (sourceId && !directGoogleSetup) {
    await continueChiefSession(
      msg.workspaceId,
      sourceId,
      receipt,
      msg.executorCapability,
      action.threadRootId,
    );
  }
  return;
}

export async function handleExpandRecurringWorkGrant({
  authorizeWorkspace,
  broadcastWorkspaceData,
  manager,
  msg,
  scheduler,
}: {
  authorizeWorkspace: Authorize<ExpandMessage>;
  broadcastWorkspaceData: (workspaceId: string) => Promise<void>;
  manager: SessionManager;
  msg: ExpandMessage;
  scheduler: RecurringWorkScheduler;
}) {
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
        /^tools\.[A-Za-z0-9_.-]+$/.test(address) && blocked.includes(address),
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
      toolPatterns: [...new Set([...work.grant.toolPatterns, ...addTools])],
    },
    status: work.onceAt !== undefined && !msg.rerun ? "paused" : "active",
    updatedAt: Date.now(),
  });
  for (const suffix of ["approval", "blocked", "failed", "required-source"]) {
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
  return;
}
