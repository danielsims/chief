import type { JsonObject } from "@chief/relay-contracts";

import type { HostedAgentToolContext } from "../context";
import { publishAgentMessage } from "../../agent-message-publisher";
import { hostedPluginPlacement } from "../../hosted-agent-plugin-tools";
import { deterministicUuid } from "../../hosted-agent-project-tools";

/**
 * Posts one card where the agent is working. Each call is its own card, so
 * showing something again lands it where the person is reading; a retried
 * turn reuses the same message rather than posting twice.
 */
export async function postHostedCard(
  { env, job }: Pick<HostedAgentToolContext, "env" | "job">,
  input: JsonObject,
  kind: string,
  key: string,
  payload: JsonObject,
) {
  const placement = hostedPluginPlacement(job.payload, input);
  const messageId = await deterministicUuid(`${job.id}:${kind}:${key}`);
  await publishAgentMessage(
    env,
    job,
    {
      ...placement,
      body: "",
      components: [
        {
          id: await deterministicUuid(`${messageId}:component`),
          kind,
          version: 1,
          payload: {
            workspaceId: job.workspaceId,
            ...placement,
            agentId: job.agentId,
            ...payload,
          },
        },
      ],
    },
    messageId,
  );
}
