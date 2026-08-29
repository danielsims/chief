import { createHash } from "node:crypto";

import type { AgentEvent, DriverType } from "./types.js";

export type SpecialistOutcome =
  { status: "completed"; result: string } | { status: "failed"; error: string };

export interface SpecialistOutcomeManager {
  finishChildChat(
    workspaceId: string,
    sessionId: string,
    outcome: SpecialistOutcome,
  ): void | Promise<void>;
  waitForChatPersistence(workspaceId: string, sessionId: string): Promise<void>;
  raiseActionItem(
    workspaceId: string,
    action: {
      id: string;
      agentId: string;
      title: string;
      reason: string;
      sourceId: string;
      status: "open";
      createdAt: number;
    },
  ): void | Promise<void>;
  dismissActionItem(
    workspaceId: string,
    actionId: string,
  ): void | Promise<void>;
  store: {
    listBrowserRuns(
      workspaceId: string,
    ): Promise<readonly { conversationId: string; status: string }[]>;
    listActionItems(
      workspaceId: string,
    ): Promise<readonly { id: string; agentId: string; sourceId?: string }[]>;
    chatRecord(
      workspaceId: string,
      sessionId: string,
    ): Promise<{ title: string } | null>;
    updateChatState(
      workspaceId: string,
      sessionId: string,
      state: { status: "waiting"; summary: string },
    ): boolean | void | Promise<boolean | void>;
  };
}

export function terminalSpecialistOutcome(
  events: readonly AgentEvent[],
): SpecialistOutcome | undefined {
  let currentTurnStartedAt = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "message" && event.role === "user") {
      currentTurnStartedAt = index;
      break;
    }
  }
  for (
    let index = events.length - 1;
    index > currentTurnStartedAt;
    index -= 1
  ) {
    const event = events[index];
    if (event?.type !== "result") continue;
    return event.ok
      ? {
          status: "completed",
          result:
            lastAssistantText(events.slice(currentTurnStartedAt + 1)) ??
            "The specialist completed the task without a text result.",
        }
      : {
          status: "failed",
          error: event.error ?? "The specialist task failed.",
        };
  }
  let exitOutcome: SpecialistOutcome | undefined;
  for (
    let index = events.length - 1;
    index > currentTurnStartedAt;
    index -= 1
  ) {
    const event = events[index];
    if (!event) continue;
    if (event.type === "error") {
      return { status: "failed", error: event.message };
    }
    if (event.type === "exit") {
      exitOutcome = {
        status: "failed",
        error: "The specialist session exited before returning a result.",
      };
    }
  }
  return exitOutcome;
}

export function lastAssistantText(events: readonly AgentEvent[]) {
  return events
    .flatMap((event) =>
      event.type === "message" && event.role === "assistant"
        ? event.content.flatMap((block) =>
            block.type === "text" ? [block.text] : [],
          )
        : [],
    )
    .at(-1);
}

export function isDriver(value: string): value is DriverType {
  return ["claude", "codex", "opencode", "remote"].includes(value);
}

export function setupNeedsHumanSignIn(result: string | undefined) {
  return Boolean(
    result &&
    (/pending-human-signin/i.test(result) ||
      /(?:please|user).{0,80}(?:sign[ -]?in|authenticate|consent|mfa)/i.test(
        result,
      )),
  );
}

function setupAttentionId(workspaceId: string, sessionId: string) {
  return `action-${createHash("sha256")
    .update(`${workspaceId}\0${sessionId}\0setup-browser-handoff`)
    .digest("hex")
    .slice(0, 32)}`;
}

async function syncSetupAttention(input: {
  manager: SpecialistOutcomeManager;
  workspaceId: string;
  sessionId: string;
  waitingForUser: boolean;
}) {
  const openActions = await input.manager.store.listActionItems(
    input.workspaceId,
  );
  const sessionActions = openActions.filter(
    (action) =>
      action.agentId === "setup" && action.sourceId === input.sessionId,
  );
  if (!input.waitingForUser) {
    await Promise.all(
      sessionActions.map(async (action) => {
        await input.manager.dismissActionItem(input.workspaceId, action.id);
      }),
    );
    return;
  }
  if (sessionActions.length > 0) return;

  const chat = await input.manager.store.chatRecord(
    input.workspaceId,
    input.sessionId,
  );
  const title = chat?.title.trim() ?? "Finish setup";
  await input.manager.raiseActionItem(input.workspaceId, {
    id: setupAttentionId(input.workspaceId, input.sessionId),
    agentId: "setup",
    title,
    reason: `Continue the sign-in or consent step in Setup to finish “${title}”.`,
    sourceId: input.sessionId,
    status: "open",
    createdAt: Date.now(),
  });
}

export async function persistSpecialistOutcomeState(input: {
  manager: SpecialistOutcomeManager;
  workspaceId: string;
  sessionId: string;
  agentId: string;
  outcome: SpecialistOutcome;
}) {
  const outcomeText =
    input.outcome.status === "completed"
      ? input.outcome.result
      : input.outcome.error;
  const activeSetupBrowser =
    input.agentId === "setup" &&
    (await input.manager.store.listBrowserRuns(input.workspaceId)).some(
      (run) =>
        run.conversationId === input.sessionId && run.status === "active",
    );
  const waitingForUser =
    input.agentId === "setup" &&
    (activeSetupBrowser || setupNeedsHumanSignIn(outcomeText));
  if (input.agentId === "setup") {
    await syncSetupAttention({
      manager: input.manager,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      waitingForUser,
    });
  }
  if (!waitingForUser) {
    await input.manager.finishChildChat(
      input.workspaceId,
      input.sessionId,
      input.outcome,
    );
    return;
  }
  await input.manager.waitForChatPersistence(
    input.workspaceId,
    input.sessionId,
  );
  await input.manager.store.updateChatState(
    input.workspaceId,
    input.sessionId,
    {
      status: "waiting",
      summary: outcomeText,
    },
  );
}
