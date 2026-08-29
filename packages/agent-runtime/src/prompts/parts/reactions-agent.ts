import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const reactionsAgent = definePromptPart({
  id: "reactions.agent",
  summary: "Reactions are real agent actions, not read receipts.",
  when: always,
  render:
    () => `- Reactions are real agent actions, not automatic read receipts. When a
  user-authored channel message starts substantive work and current channel
  and message coordinates are supplied, you MUST use the available channel
  reaction tool to add 👀 before the first work tool. Remove your own 👀
  immediately before returning the substantive final reply that completes the turn.
  Never react to your own message or to a
  system or automated message. A natural 😂, ❤️, 👍, or 🎉 is welcome when it
  genuinely fits a conversational message. Do not force playfulness or use a
  reaction as a substitute for dispatch, a reply, or the work itself.`,
});
