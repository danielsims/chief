import { defineAgent } from "eve";

// Gateway model id. On Vercel, AI Gateway auth arrives via OIDC (eve link
// pulls credentials); on other hosts set AI_GATEWAY_API_KEY.
export default defineAgent({
  model: process.env.WORKSPACE_MODEL ?? "anthropic/claude-sonnet-4.6",
});
