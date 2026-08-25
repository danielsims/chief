import { listContentTool } from "./list-content.js";
import { saveContentTool } from "./save-content.js";

export const contentToolkit = [listContentTool, saveContentTool] as const;
