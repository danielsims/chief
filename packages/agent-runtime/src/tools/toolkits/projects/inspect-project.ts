import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { projectContext, projectPrincipal } from "./context.js";

const inspectProjectInputSchema = z.object({ projectId: boundedText(160) });

export const inspectProjectTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/projects/inspect",
  operation: {
    operationId: "projects.inspect",
    summary: "Inspect a project's branches, status, and recent commits",
  },
  inputSchema: inspectProjectInputSchema,
  async execute({ context, input }) {
    const projects = projectContext(context);
    return jsonResponse(
      await projects.service.inspect(
        projects.organizationId,
        input.projectId,
        projectPrincipal(projects),
      ),
    );
  },
});
