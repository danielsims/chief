import type { InputRequest } from "@chief/agent-runtime/types";

export const AI_GATEWAY_API_KEY = "AI_GATEWAY_API_KEY";
export const AI_GATEWAY_KEYS_URL =
  "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys&title=AI+Gateway+API+Keys";

export const AI_GATEWAY_INPUT_REQUEST: InputRequest = {
  id: "convex-ai-gateway-key",
  title: "Connect AI Gateway",
  reason:
    "Convex needs an AI Gateway key to run Chief's model. The key is stored only in this workspace's macOS Keychain vault.",
  steps: [
    {
      text: "Create an **AI Gateway API key** in Vercel, then paste it below.",
      url: AI_GATEWAY_KEYS_URL,
    },
  ],
  fields: [
    {
      key: "apiKey",
      label: "AI Gateway API key",
      type: "secret",
      save: { envKey: AI_GATEWAY_API_KEY },
    },
  ],
};
