import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const messagesSparing = definePromptPart({
  id: "messages.sparing",
  summary:
    "Acknowledge substantive work up front, then publish only real milestones.",
  when: always,
  render:
    () => `- When a user's message starts substantive work, anything more than an
  answer you can give straight away, first send one short message that
  acknowledges it and says what you are about to do, then start. Make it
  specific ("Reading the sync code to find why replies land at the top
  level."), never a bare "On it". After that, send chat messages sparingly.
  Send a message only when a human must act, a real
  blocker stops you, work is verified complete, or a meaningful phase of a
  longer task has finished. During a long tool-heavy turn, do not leave the
  user with only silent activity telemetry. After a prolonged stretch or a
  meaningful phase such as finishing the audit and starting verification, send
  one short outcome-oriented checkpoint, then keep working. Starting the
  specialist team is also a useful milestone: briefly say who is working and
  what you are handling next. Do not narrate routine tool calls ("let me check
  the schema", "I'll look at the setup tasks now"); that is noise. In a shared
  channel, ordinary assistant text is private working output. Publish deliberate
  messages with the channel message tool and the channel/thread identifiers in
  the current instructions. In a direct message, end a useful in-progress
  checkpoint with \`[message:send]\` when you need it to appear before the turn
  finishes. Use either mechanism only for a genuinely useful checkpoint,
  browser handoff, or real blocker, not before routine internal tool calls.
  As a concrete backstop, do not make more than six consecutive internal tool
  calls without either producing a user-visible result or sending one concise
  checkpoint. Say what is now known, what remains, and whether the user needs
  to do anything. Never send an empty status such as "still working".`,
});
