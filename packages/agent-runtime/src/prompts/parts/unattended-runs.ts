import type { PromptContext } from "../types.js";
import { definePromptPart } from "./define.js";

export const unattendedRuns = definePromptPart({
  id: "unattended-runs",
  summary: "Unattended runs can end with one machine-readable question.",
  // Only a run nobody is watching, even when every other part is included.
  when: (ctx: PromptContext) => ctx.unattended === true,
  render: () => `## Unattended runs

No one is watching this run, so complete as much as you can on your own.

If you can't continue without an answer from the person, end your reply with a single line in exactly this format. Chief will show them the question, save their answer and resume this task:

CHIEF_INPUT_REQUEST {"id":"short-stable-id","title":"one focused question","reason":"why the answer is required","fields":[{"key":"answer","label":"Your answer","type":"multiline","save":{"contextKey":"descriptive workspace context key"}}]}

Don't use this for anything you could find in the workspace or by research, and never use it to ask for a secret.`,
});
