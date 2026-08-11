import type { SessionManager } from "./manager.js";
import type { AgentEvent, DriverType } from "./types.js";

export type SpecialistOutcome =
  { status: "completed"; result: string } | { status: "failed"; error: string };

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

export async function persistSpecialistOutcomeState(input: {
  manager: SessionManager;
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
