import { z } from "zod";

import { runSpecialistDelegation } from "../../../specialist-delegation.js";
import { boundedText, optionalBoundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

const delegationInputSchema = z
  .object({
    conversationId: boundedText(160),
    delegationId: boundedText(64).refine(
      (id) => /^[a-z0-9][a-z0-9-]{5,63}$/u.test(id),
      "delegationId must be a unique lowercase slug.",
    ),
    agentId: boundedText(120),
    title: boundedText(160),
    task: boundedText(8_000),
    channelId: optionalBoundedText(160),
    threadRootId: optionalBoundedText(160),
    setupDomain: optionalBoundedText(255),
    setupAttemptId: optionalBoundedText(160),
    waitSeconds: z
      .number()
      .finite()
      .min(1)
      .max(90)
      .optional()
      .transform((seconds) => seconds ?? 0),
  })
  .superRefine((input, context) => {
    if (Boolean(input.setupDomain) !== Boolean(input.setupAttemptId)) {
      context.addIssue({
        code: "custom",
        message: "setupDomain and setupAttemptId must be supplied together.",
      });
    }
    if (
      input.agentId !== "setup" &&
      (input.setupDomain || input.setupAttemptId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Setup context can only be passed to the setup agent.",
      });
    }
  });

export const delegateSpecialistTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/specialists/delegate",
  operation: {
    operationId: "specialists.delegate",
    summary: "Delegate bounded work to a private specialist",
    description:
      "Creates or reuses an inspectable child session and returns promptly while longer work continues.",
  },
  inputSchema: delegationInputSchema,
  async execute({ context, input, manager, workspaceId }) {
    const setupDomain =
      input.agentId === "setup" ? input.setupDomain : undefined;
    const setupAttemptId =
      input.agentId === "setup" ? input.setupAttemptId : undefined;
    const delegation = runSpecialistDelegation({
      manager,
      workspaceId,
      conversationId: input.conversationId,
      delegationId: input.delegationId,
      agentId: input.agentId,
      title: input.title,
      task: input.task,
      channelId: input.channelId,
      threadRootId: input.threadRootId,
      setupDomain,
      setupAttemptId,
      onStateChange: context.onActivity,
      onFilesChange: context.onFilesChanged,
      onSessionReady:
        setupDomain && setupAttemptId && context.activateIntegrationSetup
          ? (sessionId) =>
              context.activateIntegrationSetup?.(
                sessionId,
                setupAttemptId,
                setupDomain,
              )
          : undefined,
    });
    let timer: NodeJS.Timeout | undefined;
    const result = await Promise.race([
      delegation,
      new Promise<{ status: "working"; delegationId: string }>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              status: "working",
              delegationId: input.delegationId,
            }),
          input.waitSeconds * 1_000,
        );
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    return jsonResponse(result);
  },
});
