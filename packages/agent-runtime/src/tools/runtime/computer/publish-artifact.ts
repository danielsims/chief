import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { computerPublishArtifactDefinition } from "../../toolkits/computer/publish-artifact.js";

export const computerPublishArtifactTool = defineLocalTool({
  ...computerPublishArtifactDefinition,
  async execute({ context, input }) {
    if (!context.publishComputerArtifact) {
      throw new Error("Artifact publishing is unavailable.");
    }
    return jsonResponse(await context.publishComputerArtifact(input));
  },
});
