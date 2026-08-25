import { computerEditFileTool } from "../../runtime/computer/edit-file.js";
import { computerExecuteCommandTool } from "../../runtime/computer/execute-command.js";
import { computerGitTool } from "../../runtime/computer/git.js";
import { computerListFilesTool } from "../../runtime/computer/list-files.js";
import { computerPublishArtifactTool } from "../../runtime/computer/publish-artifact.js";
import { computerReadFileTool } from "../../runtime/computer/read-file.js";
import { computerWriteFileTool } from "../../runtime/computer/write-file.js";

export const computerToolkit = [
  computerReadFileTool,
  computerListFilesTool,
  computerWriteFileTool,
  computerEditFileTool,
  computerExecuteCommandTool,
  computerGitTool,
  computerPublishArtifactTool,
] as const;
