import { agentIdSchema, workspaceIdSchema } from "@chief/relay-contracts";

import type { authorizeWorkspace } from "./workspace-authority";
import { withTrustedContext } from "./internal-context";

export function parseWorkspaceId(value: string | undefined) {
  return workspaceIdSchema.parse(decodeURIComponent(value ?? ""));
}

export function parseAgentId(value: string | undefined) {
  return agentIdSchema.parse(decodeURIComponent(value ?? ""));
}

export function authorizeNativeAgent(
  env: Env,
  input: {
    principal: Awaited<ReturnType<typeof authorizeWorkspace>>;
    requestId: string;
    workspaceId: ReturnType<typeof workspaceIdSchema.parse>;
    agentId: string;
  },
) {
  const target = new URL("https://workspace.internal/agents/native");
  target.searchParams.set("agentId", input.agentId);
  return env.WORKSPACES.get(env.WORKSPACES.idFromName(input.workspaceId)).fetch(
    withTrustedContext(
      new Request(target, {
        method: "POST",
        headers: { "x-chief-internal-operation": "authorize-native-agent" },
      }),
      input,
    ),
  );
}

export async function deterministicUuid(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
