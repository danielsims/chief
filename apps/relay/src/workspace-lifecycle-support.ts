import { HttpError } from "./http";

export function workspaceInference(provider: string) {
  if (provider === "vercelAiGateway") {
    return {
      provider: "vercel-ai-gateway" as const,
      model: "deepseek/deepseek-v4-flash" as const,
      secretRef: "vercel-ai-gateway" as const,
    };
  }
  return {
    provider: "opencode" as const,
    model: "opencode-go/deepseek-v4-flash" as const,
    secretRef: "opencode" as const,
  };
}

export function initialConversation(
  id: string,
  name: string,
  kind: "channel" | "direct",
) {
  return {
    id,
    name,
    kind,
    isPrivate: kind === "direct",
    unreadCount: 0,
    requiresAttention: false,
    lastMessage: null,
  };
}

export function delegationIncomplete(message: string) {
  return new HttpError(409, "onboarding_delegation_incomplete", message);
}

export async function matchesBootstrapToken(token: string, env: Env) {
  const actual = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
  const expected = hexBytes(env.BOOTSTRAP_TOKEN_SHA256);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= (actual[index] ?? 0) ^ (expected[index] ?? 0);
  }
  return difference === 0;
}

function hexBytes(value: string) {
  if (!/^[0-9a-f]{64}$/iu.test(value)) return new Uint8Array();
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}
