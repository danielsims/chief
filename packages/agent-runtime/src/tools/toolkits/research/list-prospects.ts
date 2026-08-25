import { defineAgentTool } from "../../definition.js";

export const listProspectsDefinition = defineAgentTool({
  method: "GET",
  path: "/local-tools/prospects",
  operation: {
    operationId: "prospects.list",
    summary: "List saved prospects",
  },
});
