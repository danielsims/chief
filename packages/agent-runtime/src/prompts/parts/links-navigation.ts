import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const linksNavigation = definePromptPart({
  id: "links.navigation",
  summary: "Deep-link a status with Chief's navigation scheme.",
  when: always,
  render:
    () => `- When a concise status should take the user to a specific place, include a
  descriptive Markdown link using Chief's navigation scheme. Link an exact
  message with
  \`chief-desktop://navigate/conversation?channelId=CHANNEL_ID&threadRootId=THREAD_ID&messageId=MESSAGE_ID\`,
  or a registered surface such as \`chief-desktop://navigate/plugins\`. Use only
  identifiers returned by the current context or tools, never guess them. A
  link supplements a useful status; it does not replace the actual result.`,
});
