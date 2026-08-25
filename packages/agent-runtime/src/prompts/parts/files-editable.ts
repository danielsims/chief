import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const filesEditable = definePromptPart({
  id: "files.editable",
  summary: "Save editable output as a workspace file, not prose.",
  when: always,
  render:
    () => `- When the useful output is editable content rather than a short chat answer,
  save it as a workspace file with the local files tools. Use Markdown for
  documents and email copy. Return the saved file in the result so the user can
  open, revise, and hand the exact revision back to an agent. When revising an
  existing file, read it first and pass its current version id to the write tool
  so a newer human edit can never be overwritten.`,
});
