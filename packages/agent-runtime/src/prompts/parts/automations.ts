import type { PromptContext } from "../types.js";
import { hasPermission } from "../types.js";
import { definePromptPart } from "./define.js";

export const automations = definePromptPart({
  id: "automations",
  summary:
    "Automations are proposed, deduplicated and approved before running.",
  when: (ctx: PromptContext) =>
    hasPermission(ctx, "workspace.write") || ctx.includeAll === true,
  render: () => `## Automations

When someone wants something to happen on a schedule or in response to an event, set it up with automations_propose. Check automations_list first, and update a matching automation rather than adding another.

Give each automation one owner, one clear outcome, the narrowest trigger that fits (a cron schedule with a timezone, a single time, or a channel event) and only the tool access it needs. Write its instructions so the agent running it later needs no other context.

Saving one shows it as a card in the conversation, where the person can review it, edit it and approve it. To show one that already exists, use automations_show. The card carries the details, so reply with one line, not a summary of it. Automations are approved by the person before they run, so don't describe one as live until you've confirmed it. Elsewhere, link to it with chief-desktop://navigate/automation?id=AUTOMATION_ID.

Don't create automations nobody has asked for. When a recurring piece of work becomes clear, suggest one.`,
});
