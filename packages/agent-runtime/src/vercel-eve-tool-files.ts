import type { EveProjectFile } from "./vercel-eve-files.js";
import type { EveChiefToolSpec } from "./vercel-eve-tool-catalog.js";
import { eveChiefTools, eveToolFileSlug } from "./vercel-eve-tool-catalog.js";

export const eveChiefSessionSource = `import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { defineState } from "eve/context";
import { z } from "zod";

export const chiefDeliverySchema = z.object({
  deliveryId: z.string(), capability: z.string(), agentId: z.string(),
  conversationId: z.string(), messageId: z.string(), threadRootId: z.string(),
});
const deliveryKey = () => {
  const token = process.env.CHIEF_CHANNEL_TOKEN;
  if (!token) throw new Error("CHIEF_CHANNEL_TOKEN is required.");
  return createHash("sha256").update("chief.delivery.v1:" + token).digest();
};
export function sealChiefDelivery(state: z.infer<typeof chiefDeliverySchema>) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deliveryKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url");
}
export function openChiefDelivery(value: unknown) {
  if (typeof value !== "string") return null;
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length < 29) throw new Error("Invalid Chief delivery envelope.");
  const decipher = createDecipheriv("aes-256-gcm", deliveryKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return chiefDeliverySchema.parse(JSON.parse(Buffer.concat([
    decipher.update(bytes.subarray(28)), decipher.final(),
  ]).toString("utf8")));
}
export type ChiefDelivery = z.infer<typeof chiefDeliverySchema> & { sessionId: string };
export const chiefSession = defineState("chief.delivery", () => ({
  delivery: null as ChiefDelivery | null,
  published: false,
  delegated: false,
}));
export function setCurrentChiefDelivery(value: ChiefDelivery) {
  chiefSession.update((current) => current.delivery?.deliveryId === value.deliveryId
    ? { ...current, delivery: value }
    : { delivery: value, published: false, delegated: false });
}
export function currentChiefDelivery() {
  const delivery = chiefSession.get().delivery;
  if (!delivery) throw new Error("Chief delivery context is missing for this turn.");
  return delivery;
}
export function hasChiefMessagePosted() { return chiefSession.get().published; }
export function noteChiefMessagePosted() {
  chiefSession.update((current) => ({ ...current, published: true }));
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
  agentId: string,
  context: { session: { id: string; parent?: { rootSessionId: string } } },
) {
  const delivery = { ...currentChiefDelivery(), sessionId: context.session.parent?.rootSessionId ?? context.session.id };
  if (delivery.agentId !== agentId) throw new Error("This delivery is assigned to another agent.");
  if (!delivery.deliveryId || !delivery.capability || !delivery.sessionId) {
    throw new Error("Chief delivery context is missing for this turn.");
  }
  const channelScoped = new Set([
    "channels.get", "channels.members.list", "channels.members.add",
    "channels.messages.list", "channels.messages.get", "channels.messages.post",
    "channels.messages.replies", "channels.reactions.list", "channels.reactions.add",
    "channels.reactions.remove", "projects.recommend",
  ]).has(operationId);
  const messageScoped = new Set([
    "channels.messages.get", "channels.messages.replies", "channels.reactions.list",
    "channels.reactions.add", "channels.reactions.remove",
  ]).has(operationId);
  const threadScoped = operationId === "channels.messages.post" || operationId === "projects.recommend";
  const channelId = channelScoped ? input.channelId ?? delivery.conversationId : undefined;
  const messageId = messageScoped ? input.messageId ?? delivery.messageId : undefined;
  const threadRootId = threadScoped
    ? input.threadRootId ?? (channelId === delivery.conversationId ? delivery.threadRootId : undefined)
    : undefined;
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
    \`/v1/workspaces/\${encodeURIComponent(required("CHIEF_WORKSPACE_ID"))}/agents/\${encodeURIComponent(agentId)}/channel/tools\`,
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
    noteChiefMessagePosted();
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

function eveToolFileSource(
  tool: EveChiefToolSpec,
  agentId?: string,
  prefix = "../",
) {
  return `import { defineTool } from "eve/tools";
import { z } from "zod";
import { callChiefTool } from "${prefix}lib/chief-tool.ts";

export default defineTool({
  description: ${JSON.stringify(`${tool.description} Chief operation ${tool.operationId} (${tool.method} ${tool.path}).`)},
  inputSchema: ${inputSchemaSource(tool)},
  execute: (input, context) => callChiefTool(${JSON.stringify(tool.operationId)}, input, ${agentId ? JSON.stringify(agentId) : 'process.env.CHIEF_AGENT_ID ?? ""'}, context),
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

export function eveSubagentToolFiles(
  directory: string,
  agentId: string,
): EveProjectFile[] {
  return eveChiefTools.map((tool) => ({
    path: `agent/subagents/${directory}/tools/${eveToolFileSlug(tool.operationId)}.ts`,
    contents: eveToolFileSource(tool, agentId, "../../../"),
  }));
}
