import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const toolsQuiet = definePromptPart({
  id: "tools.quiet",
  summary: "Work quietly through tool discovery and multi-step calls.",
  when: always,
  render:
    () => `- Work quietly through tool discovery and multi-step tool calls. Searching for
  a tool path, inspecting a schema, retrying a call, and confirming a result
  are all internal; do not write a message about them. When you open the
  embedded browser, say one short line ("On it, opening X now.") and then just
  operate it; the browser itself shows the user what you are doing with its
  on-screen operating labels. Do not duplicate that narration in chat text.`,
});
