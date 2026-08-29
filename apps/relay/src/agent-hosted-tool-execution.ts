import type { AgentInferenceToolCall } from "@chief/agent-computer";
import type { AgentPrincipal } from "@chief/relay-contracts";
import { UnavailableToolError } from "@chief/agent-runtime/durable-turn";

import type { AgentExecutionEnvironment } from "./agent-execution-environment";
import { publishHostedBrowserActivity } from "./agent-hosted-activity";
import { executeHostedAgentTool } from "./hosted-agent-tools";

type AgentJob = Parameters<typeof executeHostedAgentTool>[4];

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

export async function executeObservedHostedAgentTool(
  execution: AgentExecutionEnvironment,
  browserEnabled: boolean,
  computerEnabled: boolean,
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  name: string,
  rawArguments: AgentInferenceToolCall["arguments"],
) {
  let output;
  try {
    output = await runHostedToolWithDeadline(
      () =>
        executeHostedAgentTool(
          execution.computer,
          browserEnabled ? execution.browser : undefined,
          computerEnabled,
          env,
          job,
          principal,
          name,
          rawArguments,
        ),
      () => execution.browser.close(),
    );
  } catch (error) {
    if (
      name.startsWith("browser_") &&
      error instanceof Error &&
      error.message.startsWith("Hosted tool exceeded")
    ) {
      throw new UnavailableToolError(
        "The interactive browser timed out. Continue now with web_read, another source, or the evidence already available.",
      );
    }
    throw error;
  }
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
