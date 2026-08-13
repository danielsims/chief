import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { SessionManager } from "./manager.js";
import type { AgentSession } from "./session.js";
import type { AgentEvent, ClientMessage, ServerMessage } from "./types.js";
import { getAgent } from "./agents.js";
import {
  availableCapabilities,
  composeAgentCapabilities,
} from "./capabilities/index.js";
import { channelChatId } from "./channels/nip29.js";
import * as channelBridge from "./channels/server-bridge.js";
import { syncMissionControlHeartbeat } from "./mission-control-heartbeat.js";
import { ensureOnboardingGeneralChannel } from "./onboarding-general-channel.js";
import {
  ONBOARDING_OPENING_MESSAGE,
  onboardingDirectory,
  onboardingKickoffId,
  onboardingKickoffProgress,
  onboardingLocalKickoffInstructions,
  onboardingOpeningIsVisible,
  onboardingRecoveryPrompt,
} from "./onboarding-kickoff.js";
import { persistOnboardingSchedules } from "./onboarding-schedule-persistence.js";
import { ensureExecutorWorkspace } from "./tools/control-plane.js";
import { executorToolServer } from "./tools/spec.js";
import {
  readWorkspaceContext,
  writeWorkspaceContext,
} from "./workspace-context.js";
import { workspaceRoot } from "./workspace-secrets.js";
import { readWorkspaceWaysOfWorking } from "./workspace-ways-of-working.js";

type Message = Extract<ClientMessage, { type: "bootstrapOnboardingWork" }>;
interface Bootstrap {
  signature: string;
  ready: Promise<string>;
  run: Promise<string>;
}

export async function handleBootstrapOnboardingWork({
  authorizeWorkspace,
  bindRootSession,
  broadcastChannels,
  broadcastWorkspaceData,
  chatDestinations,
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
  broadcastChannels: (workspaceId: string) => void | Promise<void>;
  broadcastWorkspaceData: (workspaceId: string) => Promise<void>;
  chatDestinations: Map<string, string>;
  manager: SessionManager;
  msg: Message;
  onboardingBootstraps: Map<string, Bootstrap>;
  send: (message: ServerMessage) => void;
}) {
  await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
  const waysOfWorking = readWorkspaceWaysOfWorking(msg.workspaceId);
  const missionChannelId = waysOfWorking.missionControlChannelId;
  const chatId = channelChatId(msg.workspaceId, missionChannelId);
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
  let bootstrap = activeBootstrap;
  if (!bootstrap) {
    let resolveReady!: (chatId: string) => void;
    let rejectReady!: (error: unknown) => void;
    const ready = new Promise<string>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const preparedRun = (async () => {
      console.log(
        `[chief] preparing onboarding in the mission channel for ${msg.workspaceId}`,
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
        "chief",
      );
      const driver = msg.driver ?? existingPreference?.driver;
      if (!driver) {
        throw new Error(
          "Choose a Chief agent app before opening the workspace.",
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
        agentId: "chief",
        enabled: true,
        driver,
        model,
      });

      const chiefOnboardingDirectory = onboardingDirectory(
        workspaceRoot(msg.workspaceId),
        "chief",
      );
      mkdirSync(chiefOnboardingDirectory, {
        recursive: true,
        mode: 0o700,
      });
      const attachmentPaths: string[][] = [];
      let totalBytes = 0;
      for (const [jobIndex, job] of msg.jobs.entries()) {
        if (!getAgent(job.agentId)) {
          throw new Error("Unknown onboarding agent.");
        }
        const attachmentDirectory = onboardingDirectory(
          workspaceRoot(msg.workspaceId),
          job.agentId,
        );
        mkdirSync(attachmentDirectory, {
          recursive: true,
          mode: 0o700,
        });
        const saved: string[] = [];
        for (const [attachmentIndex, attachment] of (
          job.attachments ?? []
        ).entries()) {
          const match = /^data:[^;]+;base64,(.+)$/.exec(attachment.dataUrl);
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
            attachmentDirectory,
            `${jobIndex + 1}-${attachmentIndex + 1}-${safeName || "attachment"}`,
          );
          writeFileSync(path, bytes, { mode: 0o600 });
          saved.push(path);
        }
        attachmentPaths[jobIndex] = saved;
      }

      const jobs = msg.jobs.map((job) => {
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
      const planPath = join(chiefOnboardingDirectory, "onboarding.md");
      writeFileSync(
        planPath,
        [
          "# Workspace onboarding",
          "",
          "This is the durable setup plan for the workspace mission channel.",
          "Chief should work through it conversationally with the workspace owner and bring Setup into the thread when a provider requires browser authorization or credentials.",
          "",
          "## Setup and initial work",
          jobs.length > 0 ? jobs.join("\n") : "- No setup work selected.",
          "",
          "## Recurring work",
          schedules.length > 0
            ? schedules.join("\n")
            : "- No recurring work selected.",
          "",
        ].join("\n"),
        { mode: 0o600 },
      );
      const channel = await manager.store
        .channelStore()
        .get(msg.workspaceId, missionChannelId);
      if (!channel) {
        throw new Error("Chief could not find the workspace mission channel.");
      }
      await manager.createRootChat(
        msg.workspaceId,
        chatId,
        "Initial business review",
        driver,
        model,
      );
      // Calendar persistence starts independently and cannot own or block the
      // mission-control turn. Every saved schedule gets its own valid channel
      // conversation before the local store accepts it.
      const backgroundSetup = Promise.allSettled([
        persistOnboardingSchedules({
          manager,
          workspaceId: msg.workspaceId,
          schedules: msg.schedules,
          missionChannelId,
          fallbackConversationId: chatId,
          driver,
          model,
          now,
        }),
        syncMissionControlHeartbeat(manager, msg.workspaceId, waysOfWorking),
      ]);

      const persistedMessages = await manager.transcript(
        msg.workspaceId,
        chatId,
      );
      const kickoffId = onboardingKickoffId(chatId);
      const kickoff = onboardingKickoffProgress(persistedMessages, kickoffId);
      if (!kickoff.completed) {
        const chief = getAgent("chief");
        if (!chief) throw new Error("Chief persona is missing.");
        const capabilities = existingPreference?.capabilities;
        const capableChief = capabilities
          ? composeAgentCapabilities(
              chief,
              availableCapabilities.filter((capability) =>
                capabilities.includes(capability.id),
              ),
            )
          : chief;
        const integratedChief = existingPreference?.integrations
          ? {
              ...capableChief,
              instructions: `${capableChief.instructions}\n\nAssigned integrations: ${existingPreference.integrations.length > 0 ? existingPreference.integrations.join(", ") : "none"}. Only search for and call integration tools from this assigned set.`,
            }
          : capableChief;
        const effectiveChief = channelBridge.agentForChannel(
          integratedChief,
          undefined,
          channel,
          msg.workspaceContext ?? readWorkspaceContext(msg.workspaceId),
          readWorkspaceWaysOfWorking(msg.workspaceId).missionControlChannelId,
        );
        const executorWorkspace = await ensureExecutorWorkspace(
          msg.workspaceId,
          msg.executorCapability,
        ).catch((error: unknown) => {
          console.error(
            `[runtime] Executor workspace unavailable for ${chatId}:`,
            error,
          );
          return null;
        });
        const session = await manager.ensureRootChat(effectiveChief, chatId, {
          driver,
          access: "full",
          workspaceId: msg.workspaceId,
          model,
          mcpServers: executorWorkspace
            ? [executorToolServer(executorWorkspace, "model")]
            : [],
          executionOwner: "interactive",
        });
        chatDestinations.set(`${msg.workspaceId}\0${chatId}`, channel.id);
        bindRootSession(msg.workspaceId, chatId, session);
        if (session.isBusy) {
          resolveReady(chatId);
          await broadcastWorkspaceData(msg.workspaceId);
          return chatId;
        }
        resolveReady(chatId);
        const sendOnboardingPrompt = async (
          prompt: string,
          messageId?: string,
          record = true,
        ) => {
          const releaseExecution = manager.acquireExecution(
            msg.workspaceId,
            chatId,
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
            await session.sendPrompt(prompt, messageId, record);
            await manager.waitForChatPersistence(msg.workspaceId, chatId);
          } catch (error) {
            session.off("event", releaseOnTerminal);
            releaseExecution();
            throw error;
          }
        };
        let initialError: unknown;
        try {
          const initialPrompt = kickoff.started
            ? onboardingRecoveryPrompt(
                driver,
                !onboardingOpeningIsVisible(persistedMessages, kickoffId),
                channel.id,
              )
            : [
                `Start by publishing this exact text as the first channel message with localTools.channelsMessagesPost using channelId ${JSON.stringify(channel.id)}:\n\n${ONBOARDING_OPENING_MESSAGE}\n\nDo not write it as ordinary assistant text and do not add another acknowledgement. Continue working in this same turn as soon as the tool succeeds.`,
                onboardingLocalKickoffInstructions(channel.id),
                `Only after every independent kickoff call succeeds, publish one calm sentence of at most 18 words with localTools.channelsMessagesPost using channelId ${JSON.stringify(channel.id)}. Name who is underway without repeating their task briefs, listing sources, or previewing another review. Then keep working. Never claim a job started before its kickoff call succeeds, and never duplicate a thread kickoff as another status message.`,
                `Do useful public-source and workspace work immediately. When credentials, consent, or account selection are genuinely required, Setup must explain the exact next step inside its own thread and keep the secure browser waiting there. Do not mirror that browser or raise a duplicate top-level action in #${channel.name}.`,
                "Persist useful results only in their dedicated surfaces, such as the brand profile, prospects, analytics, connections, and channel threads. Do not create or attach a generic initial business review file.",
                `Keep all user-facing progress and the final synthesis in this channel by calling localTools.channelsMessagesPost with channelId ${JSON.stringify(channel.id)}. Ordinary assistant text is private working output. Do not treat agent activity as a user-facing message.`,
              ].join("\n\n");
          await sendOnboardingPrompt(
            initialPrompt,
            kickoff.started ? undefined : kickoffId,
            !kickoff.started,
          );
        } catch (error) {
          initialError = error;
          await manager.waitForChatPersistence(msg.workspaceId, chatId);
        }
        const afterInitialEvents = await manager.transcript(
          msg.workspaceId,
          chatId,
        );
        const afterInitialAttempt = onboardingKickoffProgress(
          afterInitialEvents,
          kickoffId,
        );
        if (!afterInitialAttempt.completed) {
          console.error(
            `[chief] initial onboarding turn did not complete for ${msg.workspaceId}; recovering once`,
            initialError,
          );
          await sendOnboardingPrompt(
            onboardingRecoveryPrompt(
              driver,
              !onboardingOpeningIsVisible(afterInitialEvents, kickoffId),
              channel.id,
            ),
            undefined,
            false,
          );
        }
      }
      const setupResults = await backgroundSetup;
      for (const result of setupResults) {
        if (result.status === "rejected") {
          console.error(
            "[chief] non-blocking onboarding setup failed:",
            result.reason,
          );
        }
      }
      await ensureOnboardingGeneralChannel({
        manager,
        workspaceId: msg.workspaceId,
        onChannelsChanged: () => broadcastChannels(msg.workspaceId),
      }).catch((error: unknown) =>
        console.error("[chief] General channel membership failed:", error),
      );
      resolveReady(chatId);
      await broadcastWorkspaceData(msg.workspaceId);
      return chatId;
    })();
    const run = preparedRun.catch((error: unknown) => {
      rejectReady(error);
      throw error;
    });
    bootstrap = {
      signature,
      ready,
      run,
    };
    onboardingBootstraps.set(msg.workspaceId, bootstrap);
    void run
      .catch((error: unknown) =>
        console.error(
          `[chief] onboarding run failed for ${msg.workspaceId}:`,
          error,
        ),
      )
      .finally(() => {
        if (onboardingBootstraps.get(msg.workspaceId)?.run === run) {
          onboardingBootstraps.delete(msg.workspaceId);
        }
      });
  }
  await bootstrap.ready;
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
    `[chief] mission channel onboarding prepared for ${msg.workspaceId}`,
  );
}
