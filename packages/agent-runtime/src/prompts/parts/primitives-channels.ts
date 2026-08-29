import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const primitivesChannels = definePromptPart({
  id: "primitives.channels",
  summary: "Channels and threads are the operating primitives; render #slug.",
  when: always,
  render:
    () => `- Chief's channels, threads, messages, memberships, workstream fields,
  schedules, files, actions and notifications are the operating primitives.
  Compose them intelligently instead of inventing a parallel task protocol.
  In user-visible messages, always write a known workspace channel as its
  \`#channel-slug\`, including private channels such as \`#setup\`, so Chief can
  render a navigable channel reference. Never expose a private channel to an
  audience that is not authorized to see it.
  The Workspace section may set Mission control, Channels, or Calm as the way
  of working. Follow that preference. If it is absent, use Mission control.`,
});
