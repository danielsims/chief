import { gateway, generateText, tool } from "ai";
import { z } from "zod/v4";

import { SPECIALIST_INSTRUCTIONS } from "./generated";

const specialist = z.enum([
  "brand",
  "prospector",
  "setup",
  "analyst",
  "ads",
  "content",
]);
const controlPaths = {
  listRecords: ["GET", "/agent-tools/records"],
  listSources: ["GET", "/agent-tools/sources"],
  saveProspect: ["POST", "/agent-tools/prospects"],
  saveFile: ["POST", "/agent-tools/files"],
  saveAction: ["POST", "/agent-tools/actions"],
  dismissAction: ["POST", "/agent-tools/actions/dismiss"],
  markIntegrationConnected: ["POST", "/agent-tools/integrations/connected"],
  presentChart: ["POST", "/agent-tools/ui/chart"],
} as const;

async function controlPlane(
  operation: keyof typeof controlPaths,
  body?: Record<string, unknown>,
) {
  const configuredBase = process.env.CHIEF_CONTROL_PLANE_API_BASE_URL;
  const token = process.env.CHIEF_CONTROL_PLANE_TOKEN;
  if (!configuredBase || !token) {
    throw new Error("Chief control-plane credentials are not configured.");
  }
  const base = new URL(configuredBase);
  if (base.protocol !== "https:" || base.username || base.password) {
    throw new Error("Chief control-plane URL must be HTTPS.");
  }
  const [method, path] = controlPaths[operation];
  const payload = method === "POST" && body ? JSON.stringify(body) : undefined;
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    body: payload,
    redirect: "error",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Chief ${operation} failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function chiefTools(model: string) {
  return {
    delegateToSpecialist: tool({
      description:
        "Delegate one bounded, read-only task to a private Chief specialist.",
      inputSchema: z.object({
        specialist,
        task: z.string().min(1).max(8_000),
      }),
      execute: async ({ specialist: id, task }) => {
        const result = await generateText({
          model: gateway(model),
          system: SPECIALIST_INSTRUCTIONS[id],
          prompt: task,
          maxOutputTokens: 2_000,
          maxRetries: 1,
        });
        return result.text;
      },
    }),
    chiefControlPlane: tool({
      description:
        "Read or update this workspace through Chief's authenticated control plane. Use only the named operation.",
      inputSchema: z.object({
        operation: z.enum(
          Object.keys(controlPaths) as [
            keyof typeof controlPaths,
            ...(keyof typeof controlPaths)[],
          ],
        ),
        body: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: async ({ operation, body }) => controlPlane(operation, body),
    }),
  };
}
