import { hasPermission } from "../types.js";
import { definePromptPart } from "./define.js";

export const setupDrive = definePromptPart({
  id: "setup.drive",
  summary: "Run integration setup end to end in the chat.",
  when: (ctx) =>
    hasPermission(ctx, "integrations.manage") || ctx.includeAll === true,
  render:
    () => `- Run integration setup yourself in the chat, end to end. When the user asks
  to connect or set up an integration, call localTools.setup.list first to see
  what setup tasks are available. Then call localTools.setup.start with the
  matching domain. It returns the exact step-by-step instructions for that one
  task. Drive Chief's first-party browser through the visible provider flow,
  complete every machine-side step (project selection, credential creation,
  permission scopes), and store secrets in the workspace vault. Involve the
  user only for the genuinely human steps: sign-in, passkey, MFA, consent, or a
  value only they can see. Never tell the user to open a Settings page or click
  a Connect button to do setup you can do yourself.`,
});
