export type DeployTarget = "vercel";

export const AGENT_DEPLOY_PROVIDER = "agent-deploy";

const APP_PATH =
  (import.meta.env.VITE_WORKSPACE_APP_PATH as string | undefined) ??
  "$HOME/Documents/Development/marketer/apps/workspace";

export interface DeployablePlaybook {
  id: string;
  title: string;
  summary: string;
  instructions: string;
}

export function deployAgentTask(
  agent: { id: string; name: string },
  playbooks: DeployablePlaybook[],
): string {
  const deploymentInput = JSON.stringify({ agentId: agent.id });
  const playbookInput = JSON.stringify(playbooks);
  return `Deploy only the ${agent.name} agent from this Marketer workspace to Vercel. The Eve project is at ${APP_PATH}. Run every command from that directory.

Follow Eve's documented agent-directory and Vercel deployment contract. Do not invent a custom host adapter.

1. Check that Node 24 or newer is active.
2. Create workspace-input/deployment.json with this exact JSON: ${deploymentInput}
3. Create workspace-input/playbooks.json with this exact JSON: ${playbookInput}
4. Copy $MARKETER_WORKSPACE_DIR/context.md to workspace-input/context.md when it exists.
5. Call recurringWorkList and write only cloud schedules whose agentId is ${JSON.stringify(agent.id)} to workspace-input/automations.json. Use an empty array when there are none.
6. Run pnpm install --silent only if node_modules is missing, then pnpm generate and pnpm exec eve build.
7. Inspect the generated agent directory. It must contain ${agent.name} as the root instructions, its playbooks under agent/skills, and only its schedules. It must not contain another Marketer agent or subagent.
8. Run pnpm exec eve deploy. Let Eve link or create the Vercel project interactively. If browser login opens, tell the user in one sentence and wait.
9. Capture the production URL. Verify GET <url>/eve/v1/health succeeds, then run pnpm exec eve dev <url> and send: "In one sentence, identify your role." Confirm the authenticated reply is from ${agent.name}.
10. If EXECUTOR_MCP_URL and EXECUTOR_MCP_TOKEN already exist for a hosted Executor, add them to the Vercel project and redeploy. Never invent them. If they are absent, report that connected Marketer tools are not yet available to the deployed agent.

Use short progress updates and no em dashes. Read errors and adapt before stopping. Only report connected after the Eve health check and authenticated remote turn both succeed.

Finish with exactly one line:
MARKETER_SETUP_RESULT {"provider":"${AGENT_DEPLOY_PROVIDER}","status":"connected","url":"<production url>","target":"vercel","agentId":"${agent.id}"}`;
}
