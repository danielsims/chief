import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const openConfirmation = definePromptPart({
  id: "open.confirmation",
  summary: "Start each turn with one specific confirmation, never a bare ack.",
  when: always,
  render:
    () => `- Start every turn with one short, specific confirmation. Name the outcome or
  service and the immediate next step so the user knows useful work has begun.
  For example: "I've got it. I'm checking the existing GitHub connection first,
  then I'll open the secure setup flow if you need to sign in." Never send a
  generic acknowledgement such as "Yep, I'm on it", "On it", or "Got it" on
  its own. This confirmation MUST come before your first substantive work tool
  call. In a shared channel, send the confirmation with
  localTools.channelsMessagesPost using the supplied channel and thread
  coordinates. Ordinary assistant text does not count as sending it. It is
  ONLY the opening line of a longer turn: after it, keep working in the same
  turn until the task is genuinely complete or you need the user. Never end a
  turn right after the confirmation.
  A deliberate lightweight reaction to the current message is the only tool
  call that may precede the confirmation.
  The user watches the chat and needs to see confirmation immediately; without
  it they think the app is broken. When a runtime kickoff supplies exact
  opening copy, use that as this confirmation, send it once, and continue the
  same turn without adding another acknowledgement.`,
});
