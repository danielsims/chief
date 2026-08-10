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
import { channelChatId, GETTING_STARTED_CHANNEL_ID } from "./channels/nip29.js";
import * as channelBridge from "./channels/server-bridge.js";
import {
  ONBOARDING_OPENING_MESSAGE,
  onboardingDirectory,
  onboardingKickoffId,
  onboardingKickoffProgress,
  onboardingOpeningIsVisible,
  onboardingRecoveryPrompt,
} from "./onboarding-kickoff.js";
import { nextRunAt, validateCron } from "./recurring-work.js";
import { ensureExecutorWorkspace } from "./tools/control-plane.js";
import { executorToolServer } from "./tools/spec.js";
import {
  readWorkspaceContext,
  writeWorkspaceContext,
} from "./workspace-context.js";
import { workspaceRoot } from "./workspace-secrets.js";

type Message = Extract<ClientMessage, { type: "bootstrapOnboardingWork" }>;
interface Bootstrap {
  signature: string;
  ready: Promise<string>;
  run: Promise<string>;
}

export async function handleBootstrapOnboardingWork({
  authorizeWorkspace,
  bindRootSession,
  broadcastWorkspaceData,
  chatDestinations,
  closeBrowserSession,
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
  broadcastWorkspaceData: (workspaceId: string) => Promise<void>;
  chatDestinations: Map<string, string>;
  closeBrowserSession: (
    workspaceId: string,
    conversationId: string,
  ) => Promise<void>;
  manager: SessionManager;
  msg: Message;
  onboardingBootstraps: Map<string, Bootstrap>;
  send: (message: ServerMessage) => void;
}) {
  await authorizeWorkspace(msg.workspaceId, msg.executorCapability);
  const chatId = channelChatId(msg.workspaceId, GETTING_STARTED_CHANNEL_ID);
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
        `[chief] preparing getting-started channel for ${msg.workspaceId}`,
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
        agentId: "cmo",
        enabled: true,
        driver,
        model,
      });

      const chiefOnboardingDirectory = onboardingDirectory(
        workspaceRoot(msg.workspaceId),
        "cmo",
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
      const planPath = join(chiefOnboardingDirectory, "getting-started.md");
      writeFileSync(
        planPath,
        [
          "# Getting started",
          "",
          "This is the durable setup plan for the private #getting-started channel.",
          "Chief should work through it conversationally with the workspace owner and bring Setup into the channel when a provider requires browser authorization or credentials.",
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
        .get(msg.workspaceId, GETTING_STARTED_CHANNEL_ID);
      if (!channel) {
        throw new Error("Chief could not create the getting-started channel.");
      }
      await manager.createRootChat(
        msg.workspaceId,
        chatId,
        "Getting started",
        driver,
        model,
      );

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
          approvalSummary: schedule.approvalSummary.trim().slice(0, 2_000),
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

      const persistedMessages = await manager.transcript(
        msg.workspaceId,
        chatId,
      );
      const kickoffId = onboardingKickoffId(chatId);
      const kickoff = onboardingKickoffProgress(persistedMessages, kickoffId);
      if (!kickoff.completed) {
        const chief = getAgent("cmo");
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
        // A recovered onboarding run always gets a fresh browser anchor.
        await closeBrowserSession(msg.workspaceId, chatId);
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
        try {
          let initialError: unknown;
          try {
            const initialPrompt = kickoff.started
              ? onboardingRecoveryPrompt(
                  driver,
                  !onboardingOpeningIsVisible(persistedMessages, kickoffId),
                )
              : [
                  `Start by sending this exact text as the first message, followed immediately by [message:send]:\n\n${ONBOARDING_OPENING_MESSAGE}\n\nDo not add another acknowledgement. Continue working in this same turn as soon as that message is sent.`,
                  "Read onboarding/getting-started.md from the current working directory. Launch the independent specialists concurrently and exactly once by issuing the direct localTools.specialistsDelegate calls together before waiting for either. Omit waitSeconds so they continue in the background, and never search Executor for Chief-local tools.",
                  "Only after every independent delegation call returns working or completed, send one short, friendly milestone naming exactly who is underway and what you are handling next. End that milestone with [message:send], then keep working. Never claim two jobs started when only one call has been made.",
                  "Do useful public-source and workspace work immediately. When credentials, consent, or account selection are genuinely required, explain the exact next step in #getting-started and use Setup for the secure browser flow.",
                  "Keep all user-facing progress and the final synthesis in this channel. Do not treat agent activity as a user-facing message.",
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
              `[chief] initial getting-started turn did not complete for ${msg.workspaceId}; recovering once`,
              initialError,
            );
            await sendOnboardingPrompt(
              onboardingRecoveryPrompt(
                driver,
                !onboardingOpeningIsVisible(afterInitialEvents, kickoffId),
              ),
              undefined,
              false,
            );
          }
        } finally {
          // Secure sign-in handoffs use Setup's separate session.
          await closeBrowserSession(msg.workspaceId, chatId);
        }
      }
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
          `[chief] getting-started run failed for ${msg.workspaceId}:`,
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
    `[chief] getting-started channel prepared for ${msg.workspaceId}`,
  );
}
