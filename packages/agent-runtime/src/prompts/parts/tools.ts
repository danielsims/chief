import { always, hasPermission } from "../types.js";
import { definePromptPart } from "./define.js";

const browser = `Use the browser for live web pages. Take a snapshot before acting, work from what's actually on the page, and take another afterwards to confirm the result. Hand over to the person for sign-ins, multi-factor authentication, passkeys, consent or anything they should approve themselves. Keep the browser open while they do, and close it once you're finished.`;

export const tools = definePromptPart({
  id: "tools",
  summary: "Session tools, plugins, the browser and channel links.",
  when: always,
  render: (ctx) =>
    [
      "## Tools",
      "Use the tools available in this session, and read a tool's description rather than assuming how it works.",
      "If a task needs a service that isn't connected, find a suitable plugin with plugins_list and share its card with plugins_recommend so the person can connect it. Installing and authorising plugins is theirs to do.",
      ctx && (hasPermission(ctx, "browser.use") || ctx.includeAll === true)
        ? browser
        : undefined,
      "Refer to channels as #channel-slug so they appear as links. To link to a specific message, use chief-desktop://navigate/conversation?channelId=…&threadRootId=…&messageId=… with identifiers from your tools, never guessed ones.",
    ]
      .filter(Boolean)
      .join("\n\n"),
});
