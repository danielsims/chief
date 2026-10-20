import { defineAgentTool } from "../../definition.js";

export const getBrandProfileStatusDefinition = defineAgentTool({
  method: "GET",
  path: "/local-tools/brand-profile",
  operation: {
    operationId: "brandProfile.status",
    summary: "Get brand profile",
    description: "Check whether the workspace has a brand profile.",
  },
});
