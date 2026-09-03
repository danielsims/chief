import type { EveAgentProvisioningInput } from "./types.js";

export interface EveProjectFile {
  path: string;
  contents: string;
}

export function eveProjectFiles(
  input: EveAgentProvisioningInput,
): EveProjectFile[] {
  const identity = {
    id: input.agent.id ?? input.environment.CHIEF_AGENT_ID,
    name: input.agent.name,
    role: input.agent.role ?? "External agent",
    description: input.agent.description,
    capabilities: input.agent.capabilities ?? [],
    subagents: (input.agent.subagents ?? []).map((subagent) => ({
      id: subagent.id,
      name: subagent.name,
      role: subagent.role,
      description: subagent.description,
      capabilities: subagent.capabilities ?? [],
      path: `agent/subagents/${subagentDirectory(subagent.id)}`,
    })),
  };
  const subagents = (input.agent.subagents ?? []).flatMap((subagent) => {
    const directory = subagentDirectory(subagent.id);
    if (!directory) return [];
    return [
      {
        path: `agent/subagents/${directory}/agent.ts`,
        contents: `import { defineAgent } from "eve";\n\nexport default defineAgent({\n  description: ${JSON.stringify(subagent.description)},\n  model: ${JSON.stringify(input.agent.model)},\n});\n`,
      },
      {
        path: `agent/subagents/${directory}/instructions.md`,
        contents: `${subagent.instructions.trim()}\n`,
      },
    ];
  });
  return [
    {
      path: ".gitignore",
      contents: ".env\n.env.local\n.eve\n.output\nnode_modules\n",
    },
    {
      path: ".vercelignore",
      contents: ".env\n.env.local\n.eve\nnode_modules\n",
    },
    {
      path: "README.md",
      contents: `# ${input.agent.name}\n\n${input.agent.description.trim()}\n\nThis is an [eve](https://eve.dev) agent managed by Chief. The portable agent definition lives under \`agent/\`; Chief owns the \`chief\` channel that connects messages and activity to the workspace relay.\n\n## Develop\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n## Deploy\n\n\`\`\`bash\nnpm run deploy\n\`\`\`\n`,
    },
    {
      path: "package.json",
      contents: `${JSON.stringify(
        {
          name: input.project.projectName,
          private: true,
          version: "0.1.0",
          type: "module",
          imports: { "#*": "./agent/*", "#evals/*": "./evals/*" },
          engines: { node: "24.x" },
          scripts: {
            build: "eve build",
            deploy: "eve deploy",
            dev: "eve dev",
            eval: "eve eval",
            start: "eve start",
            typecheck: "tsc",
          },
          dependencies: {
            "@vercel/connect": "1.0.0",
            ai: "^7.0.82",
            eve: "^0.50.0",
            zod: "4.5.4",
          },
          devDependencies: {
            "@types/node": "25.9.1",
            typescript: "7.0.2",
          },
        },
        null,
        2,
      )}\n`,
    },
    {
      path: "tsconfig.json",
      contents: `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "esnext",
            moduleResolution: "bundler",
            types: ["node", "eve/workflow-modules"],
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            noEmit: true,
          },
          include: ["agent/**/*.ts", "evals/**/*.ts"],
        },
        null,
        2,
      )}\n`,
    },
    {
      path: "agent/agent.ts",
      contents: `import { defineAgent } from "eve";\n\nexport default defineAgent({\n  model: ${JSON.stringify(input.agent.model)},\n});\n`,
    },
    {
      path: ".chief/agent.json",
      contents: `${JSON.stringify(identity, null, 2)}\n`,
    },
    {
      path: "agent/instructions.md",
      contents: `${input.agent.instructions.trim()}\n`,
    },
    { path: "agent/channels/chief.ts", contents: chiefChannelSource },
    ...subagents,
  ];
}

function subagentDirectory(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-");
}

const chiefChannelSource = `import { createHash, timingSafeEqual } from "node:crypto";
import { defineChannel, GET, POST } from "eve/channels";
import { z } from "zod";

const deliverySchema = z.object({ payload: z.object({
  deliveryId: z.string(), sessionAddress: z.string(),
  agentId: z.string().optional(),
  continuation: z.object({ capability: z.string() }),
  message: z.object({ body: z.string() }),
}) });
type ChiefState = { deliveryId: string; capability: string; agentId: string };
const reasoningBuckets = new Map<string, number>();
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(\`\${name} is required.\`);
  return value;
};
const tokenHash = (value: string) => createHash("sha256").update(value).digest();
const authorized = (request: Request) => timingSafeEqual(
  tokenHash(request.headers.get("authorization") ?? ""),
  tokenHash(\`Bearer \${required("CHIEF_CHANNEL_TOKEN")}\`),
);
const activityId = (value: string) => value.slice(0, 128);
const activityText = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return (text ?? "").slice(0, 100_000);
};
const relayUrl = (path: "activity" | "messages", agentId: string) => new URL(
  \`/v1/workspaces/\${encodeURIComponent(required("CHIEF_WORKSPACE_ID"))}/agents/\${encodeURIComponent(agentId)}/channel/\${path}\`,
  required("CHIEF_RELAY_URL"),
);
const postToChief = async (path: "activity" | "messages", agentId: string, body: unknown) => {
  const response = await fetch(relayUrl(path, agentId), {
    method: "POST",
    headers: { "authorization": \`Bearer \${required("CHIEF_CHANNEL_TOKEN")}\`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(\`Chief returned HTTP \${response.status}.\`);
};
const postActivity = async (
  channel: { state: ChiefState },
  sessionId: string,
  component: Record<string, unknown>,
) => {
  await postToChief("activity", channel.state.agentId, {
    deliveryId: channel.state.deliveryId,
    continuation: { capability: channel.state.capability },
    sessionId,
    component,
  }).catch((error: unknown) => {
    console.error("[chief-activity] publish failed", {
      error: error instanceof Error ? error.message : String(error),
      sessionId,
    });
  });
};
const actionName = (action: { kind: string; toolName?: string; subagentName?: string; remoteAgentName?: string }) =>
  action.toolName ?? action.subagentName ?? action.remoteAgentName ?? (action.kind === "load-skill" ? "Load skill" : action.kind);
const actionResult = (result: { kind: string; toolName?: string; subagentName?: string; name?: string; output: unknown; isError?: boolean }) => ({
  name: result.toolName ?? result.subagentName ?? result.name ?? result.kind,
  output: activityText(result.output),
});

export default defineChannel<ChiefState, { state: ChiefState }>({
  state: { deliveryId: "", capability: "", agentId: "" },
  context(state) {
    return { state };
  },
  routes: [
    GET("/channels/chief/health", async (request) => {
      if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
      return Response.json({ status: "ready", agentId: required("CHIEF_AGENT_ID"), workspaceId: required("CHIEF_WORKSPACE_ID") });
    }),
    POST<ChiefState>("/channels/chief/messages", async (request, { from }) => {
      if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
      const input = deliverySchema.parse(await request.json());
      const agentId = input.payload.agentId ?? required("CHIEF_AGENT_ID");
      const session = await from(input.payload.sessionAddress).send(input.payload.message.body, {
        auth: null,
        state: { deliveryId: input.payload.deliveryId, capability: input.payload.continuation.capability, agentId },
      });
      return Response.json({ status: "accepted", sessionId: session.id });
    }),
  ],
  events: {
    async "reasoning.appended"(event, channel, context) {
      const key = \`\${event.turnId}:\${event.stepIndex}\`;
      const bucket = Math.floor(event.reasoningSoFar.length / 500);
      if (reasoningBuckets.get(key) === bucket) return;
      reasoningBuckets.set(key, bucket);
      await postActivity(channel, context.session.id, {
        id: activityId(\`reasoning:\${key}\`), kind: "thinking", version: 1,
        payload: { text: event.reasoningSoFar, status: "working", providerSessionId: context.session.id },
      });
    },
    async "reasoning.completed"(event, channel, context) {
      const key = \`\${event.turnId}:\${event.stepIndex}\`;
      reasoningBuckets.delete(key);
      await postActivity(channel, context.session.id, {
        id: activityId(\`reasoning:\${key}\`), kind: "thinking", version: 1,
        payload: { text: event.reasoning, status: "completed", providerSessionId: context.session.id },
      });
    },
    async "actions.requested"(event, channel, context) {
      for (const action of event.actions) {
        await postActivity(channel, context.session.id, {
          id: activityId(action.callId), kind: "tool", version: 1,
          payload: { name: actionName(action), status: "running", input: activityText(action.input), providerSessionId: context.session.id },
        });
      }
    },
    async "action.result"(event, channel, context) {
      const result = actionResult(event.result);
      await postActivity(channel, context.session.id, {
        id: activityId(event.result.callId), kind: "tool", version: 1,
        payload: {
          name: result.name,
          status: event.status === "completed" ? "completed" : "failed",
          ...(event.status === "completed" ? { output: result.output } : { error: event.error?.message ?? result.output }),
          providerSessionId: context.session.id,
        },
      });
    },
    async "turn.failed"(event, channel, context) {
      await postActivity(channel, context.session.id, {
        id: activityId(\`error:\${event.turnId}\`), kind: "error", version: 1,
        payload: { code: event.code, title: "Run interrupted", message: event.message, retryable: "true", providerSessionId: context.session.id },
      });
    },
    async "message.completed"(event, channel, context) {
      if (event.finishReason === "tool-calls" || !event.message) return;
      await postToChief("messages", channel.state.agentId, {
          deliveryId: channel.state.deliveryId,
          continuation: { capability: channel.state.capability },
          sessionId: context.session.id,
          body: event.message,
      });
    },
  },
});
`;
