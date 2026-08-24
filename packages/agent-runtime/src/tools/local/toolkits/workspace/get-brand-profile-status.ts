import { readWorkspaceBrandProfile } from "../../../../workspace-context.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

export const getBrandProfileStatusTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/brand-profile",
  operation: {
    operationId: "brandProfile.status",
    summary: "Check whether the workspace has a brand profile",
  },
  execute({ workspaceId }) {
    return jsonResponse({
      configured: Boolean(readWorkspaceBrandProfile(workspaceId)?.trim()),
    });
  },
});
