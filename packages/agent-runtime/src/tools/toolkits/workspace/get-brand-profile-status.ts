import { defineAgentTool } from "../../definition.js";

export const getBrandProfileStatusDefinition = defineAgentTool({
  method: "GET",
  path: "/local-tools/brand-profile",
  operation: {
    operationId: "brandProfile.status",
    summary: "Check whether the workspace has a brand profile",
  },
});
