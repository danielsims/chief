import { always } from "../types.js";
import { definePromptPart } from "./define.js";

export const filesEditable = definePromptPart({
  id: "files.editable",
  summary: "Save editable output as a workspace file, not prose.",
  when: always,
  render:
    () => `- Save substantial output as a relay workspace artifact with files.write, associated with the channel where the work belongs. Use Markdown for documents, html for self-contained interactive tools, csv for tables, or json for structured data. HTML must use inline CSS and JavaScript with no external dependencies, network access or app credentials.
- Present finished work deliberately: call channels.messages.post with a concise explanation and artifactIds containing the saved file IDs. The user gets a clickable card opening the artifact in that channel's Canvas. Do not dump the whole document into chat or claim it is saved before the tool succeeds.
- Read before revising. Pass the existing file ID and current expectedVersionId to keep the same artifact and protect human edits. An artifact stays in its original channel; create a separate copy to publish elsewhere.`,
});
