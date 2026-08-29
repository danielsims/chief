import { runSpecialistDelegation } from "../../../specialist-delegation.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { delegateSpecialistDefinition } from "./delegate-specialist-definition.js";

export const delegateSpecialistTool = defineLocalTool({
  ...delegateSpecialistDefinition,
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
