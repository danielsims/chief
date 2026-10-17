import type { AgentEvent } from "@chief/agent-runtime/types";

import { isExpectedRuntimeStop, visibleRuntimeError } from "./runtime-messages";

export interface ChatControlState {
  status: "idle" | "running";
  /** True after the runtime has emitted real output for the current turn. */
  hasAgentOutput: boolean;
  toolProgress: Record<string, string>;
  /** Agents with a turn in progress, so several can show as working at once. */
  workingAgents: WorkingAgent[];
  lastCostUsd?: number;
  error?: ChatRuntimeError;
  errorAcknowledged?: boolean;
}

export interface WorkingAgent {
  agentId: string;
  threadRootId?: string;
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
  toolProgress: {},
  workingAgents: [],
};

function withWorkingAgent(
  controls: ChatControlState,
  agent: { agentId?: string; threadRootId?: string },
  working: boolean,
) {
  const { agentId, threadRootId } = agent;
  if (!agentId) return controls.workingAgents;
  // A terminal event without a thread root speaks for the whole agent, so it
  // clears every entry. With one, it clears that thread and any untagged
  // entry, since a mismatch must not leave the UI stuck on "working".
  const others = controls.workingAgents.filter((entry) => {
    if (entry.agentId !== agentId) return true;
    if (!threadRootId || !entry.threadRootId) return false;
    return entry.threadRootId !== threadRootId;
  });
  return working
    ? [...others, { agentId, ...(threadRootId ? { threadRootId } : undefined) }]
    : others;
}

/** Prevents process state from one conversation appearing on another while
 * React is switching the active chat and its subscription. */
export function controlsForConversation(
  controls: ChatControlState,
  controlsChatKey: string | null,
  activeChatKey: string | null,
): ChatControlState {
  return activeChatKey && controlsChatKey === activeChatKey
    ? controls
    : emptyChatControls;
}

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
    case "result": {
      const message = event.ok ? undefined : visibleRuntimeError(event.error);
      const error = message ? { message } : undefined;
      const workingAgents = event.agentId
        ? withWorkingAgent(controls, event, false)
        : [];
      return {
        ...controls,
        status: workingAgents.length > 0 ? "running" : "idle",
        workingAgents,
        lastCostUsd: event.costUsd ?? controls.lastCostUsd,
        error,
        errorAcknowledged: error ? false : undefined,
      };
    }
    case "status":
      return {
        ...controls,
        workingAgents: withWorkingAgent(
          controls,
          event,
          event.status === "running",
        ),
        status: event.status === "running" ? "running" : "idle",
        error: event.status === "running" ? undefined : controls.error,
        errorAcknowledged:
          event.status === "running" ? undefined : controls.errorAcknowledged,
      };
    case "error":
      if (isExpectedRuntimeStop(event.message)) {
        return {
          ...controls,
          status: "idle",
          workingAgents: [],
        };
      }
      return {
        ...withError(controls, {
          message: visibleRuntimeError(event.message) ?? "The agent stopped.",
          ...(event.title ? { title: event.title } : undefined),
          ...(event.code ? { code: event.code } : undefined),
          ...(event.agentId ? { agentId: event.agentId } : undefined),
        }),
        workingAgents: event.agentId
          ? withWorkingAgent(controls, event, false)
          : [],
      };
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
