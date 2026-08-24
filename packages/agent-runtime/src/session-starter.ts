import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { isJsonObject, isJsonString } from "@chief/relay-contracts";

import type { LocalStore } from "./local-store.js";
import type { SessionConfig } from "./session.js";
import type {
  AgentDefinition,
  AgentEvent,
  AgentToolPermission,
} from "./types.js";
import { agentLocalToolServer } from "./agent-local-mcp.js";
import { withPluginSkillInstructions } from "./plugins/instructions.js";
import { scopeRemoteAgentEnvironment } from "./remote-agent-environment.js";
import { AgentSession } from "./session.js";
import { workspaceRoot, workspaceSecrets } from "./workspace-secrets.js";

export interface ManagedSessionContext {
  archivedEvents: Map<string, AgentEvent[]>;
  lockWorkspaceIfInactive: (workspaceId: string) => void;
  persistence: Map<string, Promise<void>>;
  repairWorkspaceFiles: (workspaceId: string) => Promise<void>;
  released: Set<string>;
  sessionEnvironmentProvider?: (input: {
    workspaceId: string;
    agentId: string;
    sessionId: string;
    localToolPermissions?: readonly AgentToolPermission[];
  }) => Record<string, string>;
  sessions: Map<string, AgentSession>;
  startingWorkspaces: Map<string, number>;
  stopReleased: (workspaceId: string, chatId: string) => Promise<void>;
  store: LocalStore;
}

function workspaceChatKey(workspaceId: string, chatId: string) {
  return `${workspaceId}\0${chatId}`;
}

export async function startManagedSession(
  context: ManagedSessionContext,
  agent: AgentDefinition,
  chatId: string,
  config: SessionConfig,
): Promise<AgentSession> {
  await context.repairWorkspaceFiles(config.workspaceId);
  const key = workspaceChatKey(config.workspaceId, chatId);
  const storedChat = await context.store.chatRecord(config.workspaceId, chatId);
  if (!storedChat) throw new Error("Session was not found in this workspace.");
  const conversationId =
    storedChat.kind === "conversation" ? storedChat.id : storedChat.parentId;
  const runtimeContext = [
    `Runtime context: the current Chief session ID is ${chatId}. Pass this exact value as sourceId whenever you call action.raise and as sessionId whenever you call a chief-local operation.`,
    conversationId
      ? `The owning Chief conversation ID is ${conversationId}. Pass this exact value as conversationId whenever you propose scheduled work or open Chief's embedded browser. Chief-owned workspace, browser, setup, scheduling, and delegation operations are exposed as direct localTools.* tools. Call those tools directly with their documented input and never search Executor for a chief-local path. Use Executor only for connected external services.`
      : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  const sessionInstructions = withPluginSkillInstructions(
    agent.instructions,
    config.workspaceId,
  );
  const runtimeAgent = sessionInstructions.includes(
    `Runtime context: the current Chief session ID is ${chatId}.`,
  )
    ? { ...agent, instructions: sessionInstructions }
    : {
        ...agent,
        instructions: `${sessionInstructions}\n\n${runtimeContext}`,
      };
  const sessionEnvironment = context.sessionEnvironmentProvider?.({
    workspaceId: config.workspaceId,
    agentId: agent.id,
    sessionId: chatId,
    localToolPermissions: config.automationGrant?.localToolPermissions,
  });
  const scheduledLocalTools =
    config.executionOwner === "schedule" &&
    (config.automationGrant?.localToolPermissions?.length ?? 0) > 0;
  const agentLocalServer =
    (config.executionOwner !== "schedule" || scheduledLocalTools) &&
    sessionEnvironment?.CHIEF_LOCAL_URL &&
    sessionEnvironment.CHIEF_LOCAL_CAPABILITY
      ? agentLocalToolServer(
          sessionEnvironment.CHIEF_LOCAL_URL,
          sessionEnvironment.CHIEF_LOCAL_CAPABILITY,
        )
      : undefined;
  const sessionMcpServers = [
    ...(config.mcpServers ?? []),
    ...(agentLocalServer ? [agentLocalServer] : []),
  ];
  const existing = context.sessions.get(key);
  if (existing) {
    // A live session can't hop backends or change its access level.
    if (
      existing.config.driver !== config.driver ||
      existing.config.access !== config.access ||
      existing.config.workspaceId !== config.workspaceId ||
      existing.config.model !== config.model ||
      existing.agent.instructions !== runtimeAgent.instructions ||
      existing.config.executionOwner !== config.executionOwner ||
      existing.config.maxPromptAttempts !== config.maxPromptAttempts ||
      JSON.stringify(existing.config.mcpServers ?? []) !==
        JSON.stringify(sessionMcpServers)
    ) {
      if (existing.isBusy) {
        throw new Error(
          `This chat is busy with ${existing.config.executionOwner ?? "interactive"} work and cannot be replaced.`,
        );
      }
      await existing.stop();
      context.sessions.delete(key);
    } else {
      return existing;
    }
  }
  await (context.persistence.get(key) ?? Promise.resolve());

  // Mark the workspace as starting before any await so a concurrently
  // closing session can't lock (delete) its secrets mid-materialize.
  context.startingWorkspaces.set(
    config.workspaceId,
    (context.startingWorkspaces.get(config.workspaceId) ?? 0) + 1,
  );
  let env: Record<string, string>;
  try {
    env =
      config.secretAccess === false
        ? {}
        : await workspaceSecrets.materialize(config.workspaceId);
  } finally {
    const remaining =
      (context.startingWorkspaces.get(config.workspaceId) ?? 1) - 1;
    if (remaining > 0) {
      context.startingWorkspaces.set(config.workspaceId, remaining);
    } else {
      context.startingWorkspaces.delete(config.workspaceId);
    }
  }
  const scopedConfig = {
    ...config,
    additionalDirectories: [workspaceRoot(config.workspaceId)],
    env: {
      ...scopeRemoteAgentEnvironment(env, agent.id),
      ...sessionEnvironment,
      CHIEF_AGENT_ID: agent.id,
      CHIEF_SESSION_ID: chatId,
    },
    mcpServers: sessionMcpServers,
    runtimeContext,
  };
  const archivedKey = workspaceChatKey(config.workspaceId, chatId);
  const storedEvents =
    context.archivedEvents.get(archivedKey) ??
    (await context.store.transcript(config.workspaceId, chatId));
  let diagnosticPosition = (
    await context.store.diagnostics(config.workspaceId)
  ).events
    .filter((event) => event.sessionId === chatId)
    .reduce((next, event) => Math.max(next, event.position + 1), 0);
  const session = new AgentSession(
    runtimeAgent,
    chatId,
    scopedConfig,
    storedEvents,
  );
  context.sessions.set(key, session);

  session.on("event", (event: AgentEvent) => {
    const position = diagnosticPosition++;
    const persistence = (context.persistence.get(key) ?? Promise.resolve())
      .then(async () => {
        try {
          await context.store.saveDiagnosticEvent(
            config.workspaceId,
            chatId,
            position,
            event,
          );
        } catch (error) {
          console.error("[local-store] diagnostic:", error);
        }
        if (event.type === "init") {
          const currentChat = await context.store.chatRecord(
            config.workspaceId,
            chatId,
          );
          const previousProviderState =
            currentChat?.providerState &&
            isJsonObject(currentChat.providerState)
              ? currentChat.providerState
              : {};
          await context.store.updateChatState(config.workspaceId, chatId, {
            ...(config.driver === "remote"
              ? undefined
              : {
                  providerState: {
                    ...previousProviderState,
                    sessionId: event.sessionId,
                    ...(session.persistedThreadRootId
                      ? { threadRootId: session.persistedThreadRootId }
                      : undefined),
                  },
                }),
          });
        }
        if (event.type === "status" && !storedChat.scheduleId) {
          await context.store.updateChatState(config.workspaceId, chatId, {
            status: event.status === "error" ? "failed" : event.status,
          });
        }
        if (
          event.type === "message" ||
          event.type === "result" ||
          event.type === "error" ||
          event.type === "permissionResolved"
        ) {
          await context.store.saveTranscript(
            {
              id: chatId,
              organizationId: config.workspaceId,
              agentId: storedChat.agent,
              driver: config.driver,
              model: config.model,
              parentId: storedChat.parentId,
              triggerId: storedChat.triggerId,
              scheduleId: storedChat.scheduleId,
              kind: storedChat.kind,
              visibility: storedChat.visibility,
              providerState: {
                ...(session.sessionId
                  ? { sessionId: session.sessionId }
                  : undefined),
                ...(session.persistedThreadRootId
                  ? { threadRootId: session.persistedThreadRootId }
                  : undefined),
              },
              eveState: session.driverState,
              scheduledFor: storedChat.scheduledFor,
              startedAt: storedChat.startedAt,
              finishedAt: storedChat.finishedAt,
              attempt: storedChat.attempt,
              summary: storedChat.summary,
              error: storedChat.error,
              artifacts: storedChat.artifacts,
              blockedTools: storedChat.blockedTools,
            },
            session.events,
          );
        }
      })
      .catch((error) => console.error("[local-store] persistence:", error));
    context.persistence.set(key, persistence);
    if (event.type === "exit") {
      context.archivedEvents.set(archivedKey, session.events.slice(-500));
      if (context.sessions.get(key) === session) {
        context.sessions.delete(key);
      }
      context.lockWorkspaceIfInactive(config.workspaceId);
    }
    if (
      context.released.has(key) &&
      (event.type === "result" ||
        event.type === "error" ||
        (event.type === "status" && event.status === "idle"))
    ) {
      void context.stopReleased(config.workspaceId, chatId);
    }
  });

  session.on("state", (state) => {
    const persistence = (context.persistence.get(key) ?? Promise.resolve())
      .then(async () => {
        await context.store.updateChatState(config.workspaceId, chatId, {
          eveState: state,
        });
      })
      .catch((error) =>
        console.error("[local-store] driver state persistence:", error),
      );
    context.persistence.set(key, persistence);
  });

  const cwd =
    storedChat.kind === "task" && !storedChat.scheduleId
      ? join(
          workspaceRoot(config.workspaceId),
          "agents",
          agent.id,
          "sessions",
          chatId,
        )
      : join(workspaceRoot(config.workspaceId), "agents", agent.id);
  mkdirSync(cwd, { recursive: true });
  const continuation =
    storedChat.provider === config.driver &&
    storedChat.providerState &&
    isJsonObject(storedChat.providerState) &&
    "sessionId" in storedChat.providerState &&
    isJsonString(storedChat.providerState.sessionId)
      ? storedChat.providerState.sessionId
      : undefined;
  try {
    await session.start(
      cwd,
      continuation,
      storedChat.provider === config.driver ? storedChat.eveState : undefined,
    );
    // Restore the channel thread this conversation was anchored to so a
    // rebuilt session keeps streaming into the same thread after a driver
    // exit instead of falling into the main timeline.
    if (
      storedChat.providerState &&
      isJsonObject(storedChat.providerState) &&
      "threadRootId" in storedChat.providerState &&
      isJsonString(storedChat.providerState.threadRootId)
    ) {
      session.persistedThreadRootId = storedChat.providerState.threadRootId;
    }
  } catch (error) {
    if (context.sessions.get(key) === session) {
      context.sessions.delete(key);
    }
    await session.stop().catch(() => undefined);
    context.lockWorkspaceIfInactive(config.workspaceId);
    throw error;
  }
  return session;
}
