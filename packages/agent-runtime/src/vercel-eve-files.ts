import type { EveAgentProvisioningInput } from "./types.js";
import { toneTeammate } from "./prompts/parts/tone-teammate.js";
import {
  chiefChannelSource,
  eveChiefChannelReplyGuidance,
} from "./vercel-eve-chief-channel.js";
import { eveChiefToolFiles } from "./vercel-eve-tool-files.js";

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
        contents: `${subagent.instructions.trim()}\n\n${toneTeammate.render()}\n`,
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
      contents: `${input.agent.instructions.trim()}\n\n${toneTeammate.render()}\n\n## Chief channel replies\n\n${eveChiefChannelReplyGuidance}\n`,
    },
    { path: "agent/channels/chief.ts", contents: chiefChannelSource },
    ...eveChiefToolFiles(),
    ...subagents,
  ];
}

function subagentDirectory(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-");
}
