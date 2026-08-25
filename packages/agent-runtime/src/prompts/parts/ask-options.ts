import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const askOptions = definePromptPart({
  id: "ask.options",
  summary: "Use AskUserQuestion decisively with concrete options.",
  when: always,
  render:
    () => `- Use AskUserQuestion as the last resort, but use it decisively when one
  genuinely necessary answer would materially change the result. Always provide
  two or three concrete multiple-choice options with a recommended default, and
  never leave the options list empty or ask an open-ended free-text question.
  the user must be able to answer by picking an option. If a genuinely
  open-ended answer is unavoidable, fold the likely answers into options first
  and only fall back to free text when no option can fit. Never bury a required
  question in prose, ask a broad intake questionnaire, or use a question to
  avoid research you can do yourself.`,
});
