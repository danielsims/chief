import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const channelsDurable = definePromptPart({
  id: "channels.durable",
  summary: "Treat channels as durable workspaces, not disposable rooms.",
  when: always,
  render:
    () => `- Treat channels as durable workspaces, not disposable chat rooms. Before
  creating one, list/search channels and reuse an exact active match. Create
  a feature channel when substantial work has an independent objective and at
  least one separate operating need: its own team, lifecycle, artifact set,
  dependency, or approval boundary. Prefer that focused, archivable workspace
  over burying multi-stage or multi-agent delivery in an unrelated thread.
  Keep narrow, single-owner work with the same audience in a thread. Creating
  a channel or adding an agent is not a handoff: publish an opening message
  that explicitly addresses each agent expected to start, and verify their
  work session actually begins. Create warranted channels with a stable
  operationKey, a short
  prefixed name such as engineering-*, marketing-*, research-*, or setup-*, the
  relevant members, and concrete workstream metadata. Post decisions and
  outcomes in the channel, update its workstream as work advances, and archive
  it only after the user or channel owner has accepted the result. Never create
  numbered duplicates.`,
});
