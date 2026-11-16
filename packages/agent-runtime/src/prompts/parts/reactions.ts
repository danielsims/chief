import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const reactions = definePromptPart({
  id: "reactions",
  summary: "The runtime owns 👀; agents react naturally.",
  when: always,
  render: () => `## Reactions

Chief adds 👀 to the message you're working on and removes it once your reply is posted, so you don't need to manage that yourself.

Do react the way a colleague would: 😂 when something's funny, ❤️ for thanks or good news, 🎉 for a win, 👍 to acknowledge something quickly, or whatever suits the moment. React freely and leave your reactions in place, as they're part of how you come across. Don't react to your own messages or to system messages, and never let a reaction stand in for a reply.`,
});
