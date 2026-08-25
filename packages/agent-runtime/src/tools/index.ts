import { createLocalToolRouter } from "./router.js";
import { workspaceTools } from "./toolkits/index.js";

export { localToolkits, workspaceTools } from "./toolkits/index.js";
export type { LocalTool } from "./tool.js";

export const workspaceToolRouter = createLocalToolRouter(workspaceTools);
