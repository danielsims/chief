import { createHash } from "node:crypto";

import type { ChannelEvent } from "./channel-types.js";
import type { SessionManager } from "./manager.js";
import type { SpecialistOutcome } from "./specialist-outcome-state.js";
import type { AgentEvent, WorkspaceFileRecord } from "./types.js";
import {
  agentEventProducedOutput,
  DEFAULT_AGENT_RETRY_DELAYS_MS,
  retryableAgentFailure,
} from "./agent-retry.js";
import { agentSkillFromPrompt } from "./agent-skills.js";
import { getAgent } from "./agents.js";
import { publishSpecialistFailure } from "./specialist-failure-publication.js";
import {
  persistInitialBrandProfileFile,
  publishSpecialistFileToThread,
} from "./specialist-file-publication.js";
import {
  isDriver,
  persistSpecialistOutcomeState,
  setupNeedsHumanSignIn,
  terminalSpecialistOutcome,
} from "./specialist-outcome-state.js";
import { existingExecutorWorkspace } from "./tools/control-plane.js";
import { executorToolServer } from "./tools/spec.js";
import {
  readWorkspaceContext,
  writeWorkspaceBrandProfile,
} from "./workspace-context.js";
import {
  hasInitialReviewKickoff,
  isInitialReviewConversation,
} from "./workspace-data.js";

const DELEGATION_INACTIVITY_TIMEOUT_MS = 6 * 60_000;
type DelegationOutcome = SpecialistOutcome;
type DelegationResult = DelegationOutcome & {
  sessionId: string;
  agentId: string;
  file?: WorkspaceFileRecord;
  retrySafe: boolean;
};
const activeDelegations = new Map<string, Promise<DelegationResult>>();

function delegationIdentity(
  input: {
    workspaceId: string;
    conversationId: string;
    agentId: string;
    delegationId: string;
  },
  singletonInitialDelegation: boolean,
) {
  const scope = singletonInitialDelegation
    ? `initial-${input.agentId}-review`
    : input.delegationId;
  return createHash("sha256")
    .update(
      `${input.workspaceId}\0${input.conversationId}\0${input.agentId}\0${scope}`,
    )
    .digest("hex")
    .slice(0, 32);
}

function notify(callback: (() => void | Promise<void>) | undefined) {
  if (!callback) return;
  try {
    void Promise.resolve(callback()).catch((error) =>
      console.error("[specialist] state broadcast failed:", error),
    );
  } catch (error) {
    console.error("[specialist] state broadcast failed:", error);
  }
}

async function notifyTerminal(
  callback: (() => void | Promise<void>) | undefined,
) {
  if (!callback) return;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(callback),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2_000);
      }),
    ]);
  } catch (error) {
    console.error("[specialist] terminal broadcast failed:", error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runSpecialistDelegation(input: {
  manager: SessionManager;
  workspaceId: string;
  conversationId: string;
  delegationId: string;
  agentId: string;
  title: string;
  task: string;
  channelId?: string;
  threadRootId?: string;
  originConversationId?: string;
  originThreadRootId?: string;
  setupDomain?: string;
  setupAttemptId?: string;
  onStateChange?: () => void | Promise<void>;
  onFilesChange?: () => void | Promise<void>;
  onChannelEvent?: (event: ChannelEvent) => void | Promise<void>;
  onSessionReady?: (sessionId: string) => void | Promise<void>;
  timeoutMs?: number;
  initialReview?: boolean;
  retryDelaysMs?: readonly number[];
}) {
  const parent = await input.manager.rootChat(
    input.workspaceId,
    input.conversationId,
  );
  const caller = getAgent(parent.chat.agent);
  const specialist = getAgent(input.agentId);
  if (!caller?.delegates?.includes(input.agentId) || !specialist) {
    throw new Error(
      `${caller?.name ?? "This agent"} cannot delegate to that specialist.`,
    );
  }

  const initialReview =
    input.initialReview ??
    (isInitialReviewConversation(input.conversationId, parent.chat.title) ||
      hasInitialReviewKickoff(parent.events));
  const singletonInitialDelegation =
    initialReview &&
    (input.agentId === "brand" || input.agentId === "prospector");
  const identity = delegationIdentity(input, singletonInitialDelegation);
  const existingSingletonSession = singletonInitialDelegation
    ? (
        await input.manager.childChats(input.workspaceId, input.conversationId)
      ).find((chat) => chat.agent === input.agentId)
    : undefined;
  const sessionId = existingSingletonSession?.id ?? `specialist-${identity}`;
  await input.onSessionReady?.(sessionId);
  const key = `${input.workspaceId}\0${sessionId}`;
  const active = activeDelegations.get(key);
  if (active) return active;

  const run = executeSpecialistDelegation(
    input,
    sessionId,
    specialist.name,
    parent.chat.provider,
    parent.chat.model,
    initialReview,
  );
  const tracked: Promise<DelegationResult> = run.finally(() => {
    if (activeDelegations.get(key) === tracked) activeDelegations.delete(key);
  });
  activeDelegations.set(key, tracked);
  return tracked;
}

async function executeSpecialistDelegation(
  input: Parameters<typeof runSpecialistDelegation>[0],
  sessionId: string,
  specialistName: string,
  parentProvider: string,
  parentModel: string | undefined,
  initialReview: boolean,
): Promise<DelegationResult> {
  const retryDelays = input.retryDelaysMs ?? DEFAULT_AGENT_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    let result: DelegationResult;
    try {
      result = await executeSpecialistDelegationAttempt(
        input,
        sessionId,
        specialistName,
        parentProvider,
        parentModel,
        initialReview,
      );
    } catch (error) {
      if (attempt >= retryDelays.length || !retryableAgentFailure(error)) {
        await publishSpecialistFailure({
          manager: input.manager,
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          threadRootId: input.threadRootId,
          sessionId,
          agentId: input.agentId,
          agentName: specialistName,
          title: input.title,
          error: error instanceof Error ? error.message : String(error),
          onChannelEvent: input.onChannelEvent,
        });
        throw error;
      }
      const delayMs = retryDelays[attempt] ?? 0;
      console.error(
        `[specialist] ${input.agentId} startup attempt ${attempt + 1}/${retryDelays.length + 1} failed (${error instanceof Error ? error.message : String(error)}); retrying in ${delayMs}ms`,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    if (
      result.status === "completed" ||
      attempt >= retryDelays.length ||
      !result.retrySafe ||
      !retryableAgentFailure(result.error)
    ) {
      if (result.status === "failed") {
        await publishSpecialistFailure({
          manager: input.manager,
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          threadRootId: input.threadRootId,
          sessionId,
          agentId: input.agentId,
          agentName: specialistName,
          title: input.title,
          error: result.error,
          onChannelEvent: input.onChannelEvent,
        });
      }
      return result;
    }
    const delayMs = retryDelays[attempt] ?? 0;
    console.error(
      `[specialist] ${input.agentId} attempt ${attempt + 1}/${retryDelays.length + 1} failed (${result.error}); retrying in ${delayMs}ms`,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
}

async function executeSpecialistDelegationAttempt(
  input: Parameters<typeof runSpecialistDelegation>[0],
  sessionId: string,
  specialistName: string,
  parentProvider: string,
  parentModel: string | undefined,
  initialReview: boolean,
): Promise<DelegationResult> {
  const existing = (
    await input.manager.childChats(input.workspaceId, input.conversationId)
  ).find((chat) => chat.id === sessionId);
  if (
    existing?.status === "waiting" &&
    input.agentId === "setup" &&
    setupNeedsHumanSignIn(existing.summary)
  ) {
    return {
      sessionId: existing.id,
      agentId: existing.agent,
      status: "completed",
      result:
        existing.summary ?? "Setup is waiting for the user to authenticate.",
      retrySafe: false,
    };
  }
  if (existing?.status === "completed") {
    const result =
      existing.summary ??
      "The specialist completed without a persisted text result.";
    const file =
      initialReview && input.agentId === "brand" && result.trim().length >= 100
        ? await persistInitialBrandProfileFile(
            input,
            existing.id,
            result.trim(),
          )
        : undefined;
    if (file) notify(input.onFilesChange);
    if (file) await publishSpecialistFileToThread(input, file);
    return {
      sessionId: existing.id,
      agentId: existing.agent,
      status: existing.status,
      result,
      retrySafe: false,
      ...(file ? { file } : {}),
    };
  }
  const existingSession = existing
    ? input.manager.get(input.workspaceId, existing.id)
    : undefined;
  const restartInterruptedSession = Boolean(
    existing &&
    (existing.status === "failed" ||
      ((existing.status === "running" || existing.status === "waiting") &&
        !existingSession?.isBusy)),
  );
  if (existing && restartInterruptedSession) {
    // Reset a failed delegation instead of re-serving stale terminal events.
    await input.manager.restartChildChat(input.workspaceId, existing.id);
  }

  const preference = await input.manager.agentPreference(
    input.workspaceId,
    input.agentId,
  );
  if (preference?.enabled === false) {
    throw new Error(`${specialistName} is disabled for this workspace.`);
  }
  const driver = preference?.driver ?? parentProvider;
  if (!isDriver(driver))
    throw new Error("No local specialist app is configured.");

  const workspace = readWorkspaceContext(input.workspaceId)?.trim();
  const specialist = getAgent(input.agentId);
  if (!specialist) throw new Error("Chief cannot delegate to that specialist.");
  const activeSkill = agentSkillFromPrompt(input.agentId, input.task);
  const privateAgent = {
    ...specialist,
    instructions: [
      specialist.instructions,
      "# Private delegation",
      input.channelId && input.threadRootId
        ? `You were explicitly invited into #${input.channelId} for this work. Publish one concise acknowledgement through localTools.channelsMessagesPost with channelId ${JSON.stringify(input.channelId)} and threadRootId ${JSON.stringify(input.threadRootId)}. Keep every meaningful checkpoint, user-action request, browser handoff, and final result in that same thread. Ordinary assistant text remains private working output. Do not post routine tool narration.`
        : undefined,
      activeSkill
        ? `# Active skill\n\n${activeSkill.instructions}`
        : input.agentId === "prospector"
          ? "You are working privately for Chief, not speaking directly to the user. Complete only the bounded prospecting task below. Use native web research and make at most three deliberate search passes. If a platform blocks direct access, try one accessible search fallback, then use indexed snippets or other sources rather than brute-forcing mirrors, captchas, or Chief internals. Save every qualified prospect with the direct localTools.prospectsSave tool before returning; include its direct HTTP source URL, evidence-based rationale, relevance, and a useful reply angle. Never search Executor for Chief-local tools. Return fewer qualified findings when the evidence is sparse instead of looping. Do not leave a prospect only in chat or ask the user questions."
          : input.agentId === "setup"
            ? input.setupDomain && input.setupAttemptId
              ? "You are working privately for Chief after onboarding, not speaking directly to the user. Inspect existing Executor connections and complete only the bounded source setup task below. Use the supplied setupDomain and setupAttemptId with this current session ID when calling Chief-local setup tools. When an authorization tool returns a consent URL, open it with localTools.browserOpen using this current session ID. Never invent a successful connection. Complete safe setup steps, then return each distinct credential, consent, or account-selection requirement with its provider identity so Chief can present one structured action per requirement. Do not ask the user questions in this private thread."
              : input.channelId && input.threadRootId
                ? "You were invited into a channel thread for one selected integration setup. Read the provider name and domain from the task, call localTools.setup.list to resolve the exact supported setup, then call localTools.setup.start for that domain. Use the returned setup attempt ID and this current session ID for every setup tool. Complete safe local steps autonomously. When sign-in, consent, account selection, or MFA needs the user, open the authorization URL in this thread with localTools.browserOpen. Then call localTools.actionRaise with this current session ID as sourceId, setup as agentId, a provider-specific title and reason, and a stable provider-scoped dedupeKey. That explicit action is what marks the owning thread and channel as needing the user. Publish one calm handoff in the same thread and leave both this job and browser waiting. Return a private result containing the exact marker pending-human-signin and the provider name so the runtime preserves that waiting state. Never close the browser or claim completion until the connection is verified."
                : "You are working privately for Chief, not speaking directly to the user. Complete only the bounded technical growth task below. Audit connected GitHub, analytics, and deployment context read-only first. Do not call integration setup tools that require an active setup attempt. Prepare a narrow implementation plan, and create a branch or draft pull request only when the task states that the user explicitly requested or approved it. Never push to a default branch, merge, deploy to production, change secrets or repository settings, or perform unrelated engineering work. Return the evidence, checks, and pull-request link to Chief. Do not ask the user questions in this private thread."
            : input.agentId === "analyst"
              ? "You are working privately for Chief, not speaking directly to the user. Use Executor's live connected-provider catalog to answer the bounded analytics question below. Dynamically inspect schemas, call the narrowest read-only tools, state exact dates and numbers, and return evidence Chief can present directly. Do not use Chief's normalized analytics wrapper or ask the user questions."
              : input.agentId === "brand"
                ? initialReview
                  ? "You are working privately for Chief, not speaking directly to the user. Complete the bounded brand research and return the complete Markdown profile. The Workspace section below already contains the current context, so do not read context.md or repeat a filesystem context lookup. Chief's runtime will save your returned Markdown automatically, so do not discover or call persistence tools. Do not inspect runtime source, environment variables, processes, ports, or Executor internals. Do not create an ad hoc handoff file or ask the user questions."
                  : 'You are working privately for Chief, not speaking directly to the user. Complete the bounded brand research, then call the direct localTools.brandProfileSave tool exactly once with input {"markdown":"<complete profile>"}. Never search Executor for Chief-local tools, and do not inspect runtime source, environment variables, processes, ports, or Executor internals. Return the complete Markdown to Chief and do not ask the user questions.'
                : "You are working privately for Chief, not speaking directly to the user. Complete only the bounded task below. Return concise evidence, analysis, or draft material for Chief to verify and synthesize. You have no durable product-write tools in this session, but you may inspect work or verify behavior by opening Chief's embedded browser with localTools.browserOpen using this current session ID. Do not ask the user questions.",
      workspace ? `# Workspace\n\n${workspace}` : undefined,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
  const session = await input.manager.ensureChildChat(
    privateAgent,
    input.conversationId,
    sessionId,
    {
      driver,
      access: preference?.approvals === "ask" ? "guarded" : "full",
      workspaceId: input.workspaceId,
      model:
        preference?.model ??
        (driver === parentProvider ? parentModel : undefined),
      executionOwner: "delegation",
      mcpServers: [
        executorToolServer(
          existingExecutorWorkspace(input.workspaceId),
          "model",
        ),
      ],
    },
    { title: input.title, triggerId: input.delegationId },
  );
  if (input.threadRootId) {
    await input.manager.store.updateChatState(input.workspaceId, sessionId, {
      triggerContext: {
        threadRootId: input.threadRootId,
        originConversationId: input.originConversationId,
        originThreadRootId: input.originThreadRootId,
      },
    });
  }
  const eventOffset = restartInterruptedSession ? session.events.length : 0;
  const outcome = await new Promise<DelegationOutcome>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout;
    const finish = (value: DelegationOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.off("event", listener);
      resolve(value);
    };
    const armTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void session.interrupt().catch(() => undefined);
        finish({
          status: "failed",
          error: "The specialist stopped after six minutes without progress.",
        });
      }, input.timeoutMs ?? DELEGATION_INACTIVITY_TIMEOUT_MS);
    };
    const listener = (_event: AgentEvent) => {
      const terminal = terminalSpecialistOutcome(
        session.events.slice(eventOffset),
      );
      if (terminal) finish(terminal);
      else armTimeout();
    };
    session.on("event", listener);
    armTimeout();
    const alreadyTerminal = terminalSpecialistOutcome(
      session.events.slice(eventOffset),
    );
    if (alreadyTerminal) {
      finish(alreadyTerminal);
      return;
    }
    void (async () => {
      if (
        existing &&
        (existing.status === "running" || existing.status === "waiting") &&
        !restartInterruptedSession &&
        !session.isBusy
      ) {
        finish({
          status: "failed",
          error:
            "Chief restarted while this specialist was running. Retry with a new delegation ID if the work is still needed.",
        });
        return;
      }
      if (!session.isBusy) {
        await input.manager.startChildChat(input.workspaceId, sessionId);
        notify(input.onStateChange);
        await session.sendPrompt(input.task, undefined, true, {
          threadRootId: input.threadRootId,
          mentions: [input.agentId],
        });
      } else {
        notify(input.onStateChange);
      }
    })().catch((error: unknown) =>
      finish({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  });
  await persistSpecialistOutcomeState({
    manager: input.manager,
    workspaceId: input.workspaceId,
    sessionId,
    agentId: input.agentId,
    outcome,
  });
  let file: WorkspaceFileRecord | undefined;
  if (
    initialReview &&
    input.agentId === "brand" &&
    outcome.status === "completed" &&
    outcome.result.trim().length >= 100
  ) {
    writeWorkspaceBrandProfile(input.workspaceId, outcome.result.trim());
    file = await persistInitialBrandProfileFile(
      input,
      sessionId,
      outcome.result.trim(),
    );
    await publishSpecialistFileToThread(input, file);
    notify(input.onFilesChange);
  }
  await notifyTerminal(input.onStateChange);
  return {
    sessionId,
    agentId: input.agentId,
    ...outcome,
    retrySafe: !session.events
      .slice(eventOffset)
      .some(agentEventProducedOutput),
    ...(file ? { file } : {}),
  };
}
