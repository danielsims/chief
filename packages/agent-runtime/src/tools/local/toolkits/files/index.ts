import { listFilesTool } from "./list-files.js";
import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";

export const filesToolkit = [
  listFilesTool,
  readFileTool,
  writeFileTool,
] as const;
