import type { AgentPrincipal } from "@chief/relay-contracts";

import type { AgentExecutionEnvironment } from "./agent-execution-environment";
import { publishHostedBrowserActivity } from "./agent-hosted-activity";
import { executeHostedAgentTool } from "./hosted-agent-tools";

type AgentJob = Parameters<typeof executeHostedAgentTool>[3];

export const HOSTED_TOOL_TIMEOUT_MS = 45_000;

export function runHostedToolWithDeadline<Output>(
  operation: () => Promise<Output>,
  release: () => Promise<void>,
  timeoutMs = HOSTED_TOOL_TIMEOUT_MS,
) {
  return new Promise<Output>((resolve, reject) => {
    const timeout = setTimeout(() => {
      void release().catch(() => undefined);
      reject(new Error(`Hosted tool exceeded ${timeoutMs}ms.`));
    }, timeoutMs);
    void operation().then(
      (output) => {
        clearTimeout(timeout);
        resolve(output);
      },
      (error) => {
        clearTimeout(timeout);
        reject(
          error instanceof Error ? error : new Error("Hosted tool failed."),
        );
      },
    );
  });
}

export async function executeObservedHostedAgentTool<Input>(
  execution: AgentExecutionEnvironment,
  browserEnabled: boolean,
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  name: string,
  rawArguments: Input,
) {
  const output = await runHostedToolWithDeadline(
    () =>
      executeHostedAgentTool(
        execution.computer,
        browserEnabled ? execution.browser : undefined,
        env,
        job,
        principal,
        name,
        rawArguments,
      ),
    () => execution.browser.close(),
  );
  await publishHostedBrowserActivity(
    env,
    job,
    principal,
    execution.browser,
    name,
    output,
  ).catch((error) => console.error("Hosted browser activity failed", error));
  return output;
}
