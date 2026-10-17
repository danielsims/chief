import { z } from "zod";

import { publishAgentMessage } from "../../agent-message-publisher";
import { hostedPluginPlacement } from "../../hosted-agent-plugin-tools";
import { deterministicUuid } from "../../hosted-agent-project-tools";
import { defineHostedAgentTool } from "../tool";

const questionInputSchema = z.object({
  question: z.string().trim().min(1).max(500),
  options: z.array(z.string().trim().min(1).max(80)).min(2).max(6),
  idempotencyKey: z.string().trim().min(1).max(120),
});

export const hostedQuestionTools = [
  defineHostedAgentTool(
    "questions.ask",
    // The question is the message body; the card carries the answers. The
    // user's next reply in the same place is the answer.
    async ({ env, job }, input) => {
      const { question, options, idempotencyKey } =
        questionInputSchema.parse(input);
      const { conversationId, threadRootId } = hostedPluginPlacement(
        job.payload,
        input,
      );
      await publishAgentMessage(
        env,
        job,
        {
          conversationId,
          ...(threadRootId ? { threadRootId } : undefined),
          body: question,
          components: [
            {
              id: await deterministicUuid(
                `${job.id}:${idempotencyKey}:question`,
              ),
              kind: "question",
              version: 1,
              payload: {
                workspaceId: job.workspaceId,
                conversationId,
                ...(threadRootId ? { threadRootId } : undefined),
                agentId: job.agentId,
                question,
                options,
              },
            },
          ],
        },
        await deterministicUuid(`${job.id}:questions.ask:${idempotencyKey}`),
      );
      return {
        asked: true,
        next: "End your turn. The user's answer arrives as their next message.",
      };
    },
    { effect: "idempotent" },
  ),
];
