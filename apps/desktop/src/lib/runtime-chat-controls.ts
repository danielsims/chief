import type { AgentEvent, AgentQuestion } from "@chief/agent-runtime/types";

import { visibleRuntimeError } from "./runtime-messages";

export interface PendingApproval {
  requestId: string;
  toolName: string;
  input: unknown;
  threadRootId?: string;
}

export interface PendingQuestion {
  requestId: string;
  questions: AgentQuestion[];
}

export interface ChatControlState {
  status: "idle" | "running";
  /** True after the runtime has emitted real output for the current turn. */
  hasAgentOutput: boolean;
  /** Tool calls waiting on the user's allow/deny decision. */
  approvals: PendingApproval[];
  /** Agent questions waiting on the user's answers. */
  questions: PendingQuestion[];
  toolProgress: Record<string, string>;
  lastCostUsd?: number;
  error?: ChatRuntimeError;
  errorAcknowledged?: boolean;
}

export interface ChatRuntimeError {
  message: string;
  title?: string;
  code?: string;
  agentId?: string;
}

export const emptyChatControls: ChatControlState = {
  status: "idle",
  hasAgentOutput: false,
  approvals: [],
  questions: [],
  toolProgress: {},
};

/** Runtime events carry process state and interactions; durable content lives
 * exclusively in the AI SDK message array. */
export function reduceChatControls(
  controls: ChatControlState,
  event: AgentEvent,
): ChatControlState {
  switch (event.type) {
    case "stream":
      return { ...controls, status: "running", hasAgentOutput: true };
    case "message":
      return reduceMessage(controls, event.role);
    case "toolProgress": {
      const current = controls.toolProgress[event.toolUseId] ?? "";
      return {
        ...controls,
        hasAgentOutput: true,
        toolProgress: {
          ...controls.toolProgress,
          [event.toolUseId]: `${current}${event.text}`.slice(-8_000),
        },
      };
    }
    case "permission":
      return reducePermission(controls, event);
    case "permissionResolved":
      return {
        ...controls,
        approvals: controls.approvals.filter(
          (approval) => approval.requestId !== event.requestId,
        ),
      };
    case "question":
      return reduceQuestion(controls, event);
    case "questionResolved":
      return {
        ...controls,
        questions: controls.questions.filter(
          (question) => question.requestId !== event.requestId,
        ),
      };
    case "result": {
      const message = event.ok ? undefined : visibleRuntimeError(event.error);
      const error = message ? { message } : undefined;
      return {
        ...controls,
        status: "idle",
        approvals: [],
        questions: [],
        lastCostUsd: event.costUsd ?? controls.lastCostUsd,
        error,
        errorAcknowledged: error ? false : undefined,
      };
    }
    case "status":
      return {
        ...controls,
        status: event.status === "running" ? "running" : "idle",
        error: event.status === "running" ? undefined : controls.error,
        errorAcknowledged:
          event.status === "running" ? undefined : controls.errorAcknowledged,
      };
    case "error":
      return withError(controls, {
        message: visibleRuntimeError(event.message) ?? "The agent stopped.",
        ...(event.title ? { title: event.title } : undefined),
        ...(event.code ? { code: event.code } : undefined),
        ...(event.agentId ? { agentId: event.agentId } : undefined),
      });
    case "exit":
      return event.code && event.code !== 0
        ? withError(controls, {
            message:
              visibleRuntimeError(
                `Agent process exited with code ${event.code}.`,
              ) ?? "The agent process stopped.",
          })
        : { ...controls, status: "idle" };
    default:
      return controls;
  }
}

/** Reconstructs diagnostics without presenting old failures as new alerts. */
export function replayChatControls(
  events: readonly AgentEvent[],
  running: boolean,
): ChatControlState {
  const controls = events.reduce(reduceChatControls, emptyChatControls);
  return {
    ...controls,
    status: running ? "running" : "idle",
    errorAcknowledged: controls.error ? true : undefined,
  };
}

function reduceMessage(
  controls: ChatControlState,
  role: "user" | "assistant",
): ChatControlState {
  const isUser = role === "user";
  return {
    ...controls,
    status: isUser ? "running" : controls.status,
    hasAgentOutput: !isUser,
    error: isUser ? undefined : controls.error,
    errorAcknowledged: isUser ? undefined : controls.errorAcknowledged,
  };
}

function reducePermission(
  controls: ChatControlState,
  event: Extract<AgentEvent, { type: "permission" }>,
): ChatControlState {
  return {
    ...controls,
    hasAgentOutput: true,
    approvals: controls.approvals.some(
      (approval) => approval.requestId === event.requestId,
    )
      ? controls.approvals
      : [
          ...controls.approvals,
          {
            requestId: event.requestId,
            toolName: event.toolName,
            input: event.input,
            threadRootId: event.threadRootId,
          },
        ],
  };
}

function reduceQuestion(
  controls: ChatControlState,
  event: Extract<AgentEvent, { type: "question" }>,
): ChatControlState {
  return {
    ...controls,
    hasAgentOutput: true,
    questions: controls.questions.some(
      (question) => question.requestId === event.requestId,
    )
      ? controls.questions
      : [
          ...controls.questions,
          { requestId: event.requestId, questions: event.questions },
        ],
  };
}

function withError(
  controls: ChatControlState,
  error: ChatRuntimeError | undefined,
): ChatControlState {
  return {
    ...controls,
    error,
    errorAcknowledged: error ? false : undefined,
    status: "idle",
  };
}
