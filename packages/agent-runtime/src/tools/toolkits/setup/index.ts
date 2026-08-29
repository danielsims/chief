import { listSetupTasksTool } from "./list-setup-tasks.js";
import { startSetupTaskTool } from "./start-setup-task.js";

export const setupToolkit = [listSetupTasksTool, startSetupTaskTool] as const;
