import { readWorkspaceBrandProfile } from "../../../workspace-context.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { getBrandProfileStatusDefinition } from "../../toolkits/workspace/get-brand-profile-status.js";

export const getBrandProfileStatusTool = defineLocalTool({
  ...getBrandProfileStatusDefinition,
  execute({ workspaceId }) {
    return jsonResponse({
      configured: Boolean(readWorkspaceBrandProfile(workspaceId)?.trim()),
    });
  },
});
