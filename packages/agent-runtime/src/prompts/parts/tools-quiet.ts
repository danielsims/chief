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
  embedded browser, operate it without narrating routine steps; the browser
  itself shows the user what you are doing. Send a message only when the user
  must take control for sign-in, consent, or another human-only action.`,
});
