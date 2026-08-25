import { writeWorkspaceBrandProfile } from "../../../workspace-context.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { saveBrandProfileDefinition } from "../../toolkits/workspace/save-brand-profile.js";

export const saveBrandProfileTool = defineLocalTool({
  ...saveBrandProfileDefinition,
  execute({ input, workspaceId }) {
    writeWorkspaceBrandProfile(workspaceId, input.markdown);
    return jsonResponse({ saved: true });
  },
});
