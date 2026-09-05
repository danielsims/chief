import type { EveProjectFile } from "./vercel-eve-files.js";
import type { EveChiefToolSpec } from "./vercel-eve-tool-catalog.js";
import { eveChiefTools, eveToolFileSlug } from "./vercel-eve-tool-catalog.js";

export const eveChiefSessionSource = `export const publishedDeliveries = new Set<string>();
export type ChiefDelivery = {
  deliveryId: string;
  capability: string;
  sessionId: string;
  conversationId: string;
  messageId: string;
  threadRootId: string;
};
export let currentChiefDelivery: ChiefDelivery = {
  deliveryId: "", capability: "", sessionId: "",
  conversationId: "", messageId: "", threadRootId: "",
};
export function setCurrentChiefDelivery(value: ChiefDelivery) {
  currentChiefDelivery = value;
}
export function noteChiefMessagePosted(deliveryId = currentChiefDelivery.deliveryId) {
  if (deliveryId) publishedDeliveries.add(deliveryId);
}
`;

export const eveChiefToolClientSource = `import {
  currentChiefDelivery,
  noteChiefMessagePosted,
} from "./chief-session.ts";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(\`\${name} is required.\`);
  return value;
};

export async function callChiefTool(
  operationId: string,
  input: Record<string, unknown>,
) {
  const delivery = currentChiefDelivery;
  if (!delivery.deliveryId || !delivery.capability || !delivery.sessionId) {
    throw new Error("Chief delivery context is missing for this turn.");
  }
  const channelId =
    typeof input.channelId === "string" && input.channelId.trim()
      ? input.channelId.trim()
      : delivery.conversationId;
  const messageId =
    typeof input.messageId === "string" && input.messageId.trim()
      ? input.messageId.trim()
      : delivery.messageId;
  const threadRootId =
    typeof input.threadRootId === "string" && input.threadRootId.trim()
      ? input.threadRootId.trim()
      : delivery.threadRootId;
  const body = {
    deliveryId: delivery.deliveryId,
    continuation: { capability: delivery.capability },
    sessionId: delivery.sessionId,
    operationId,
    input: {
      ...input,
      ...(channelId ? { channelId } : {}),
      ...(messageId ? { messageId } : {}),
      ...(threadRootId ? { threadRootId } : {}),
    },
  };
  const url = new URL(
    \`/v1/workspaces/\${encodeURIComponent(required("CHIEF_WORKSPACE_ID"))}/agents/\${encodeURIComponent(required("CHIEF_AGENT_ID"))}/channel/tools\`,
    required("CHIEF_RELAY_URL"),
  );
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: \`Bearer \${required("CHIEF_CHANNEL_TOKEN")}\`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || \`Chief returned HTTP \${response.status}.\`);
  }
  if (operationId === "channels.messages.post") {
    noteChiefMessagePosted(delivery.deliveryId);
  }
  return text ? JSON.parse(text) : { ok: true };
}
`;

function inputSchemaSource(tool: EveChiefToolSpec) {
  const fields = Object.entries(tool.input);
  if (fields.length === 0) return "z.object({})";
  return `z.object({\n${fields
    .map(([name, schema]) => `    ${name}: ${schema},`)
    .join("\n")}\n  })`;
}

function eveToolFileSource(tool: EveChiefToolSpec) {
  return `import { defineTool } from "eve/tools";
import { z } from "zod";
import { callChiefTool } from "../lib/chief-tool.ts";

export default defineTool({
  description: ${JSON.stringify(`${tool.description} Chief operation ${tool.operationId} (${tool.method} ${tool.path}).`)},
  inputSchema: ${inputSchemaSource(tool)},
  execute: (input) => callChiefTool(${JSON.stringify(tool.operationId)}, input),
});
`;
}

export function eveChiefToolFiles(): EveProjectFile[] {
  return [
    { path: "agent/lib/chief-session.ts", contents: eveChiefSessionSource },
    { path: "agent/lib/chief-tool.ts", contents: eveChiefToolClientSource },
    ...eveChiefTools.map((tool) => ({
      path: `agent/tools/${eveToolFileSlug(tool.operationId)}.ts`,
      contents: eveToolFileSource(tool),
    })),
  ];
}
