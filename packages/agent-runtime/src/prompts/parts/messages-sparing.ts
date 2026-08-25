import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const messagesSparing = definePromptPart({
  id: "messages.sparing",
  summary: "Publish chat messages only for real milestones, not narration.",
  when: always,
  render:
    () => `- Send chat messages sparingly. The opening confirmation is your first
  message; after that, only send another message when a human must act, a real
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
