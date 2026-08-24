import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { projectContext, projectPrincipal } from "./context.js";

const compareProjectBranchesInputSchema = z.object({
  projectId: boundedText(160),
  baseRef: boundedText(240),
  compareRef: boundedText(240),
});

export const compareProjectBranchesTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/projects/diff",
  operation: {
    operationId: "projects.diff",
    summary: "Compare two branches with a bounded diff",
    description:
      "Returns merge status, commit list, and a bounded combined diff between a base and compare ref. Inspect this before publishing work.",
  },
  inputSchema: compareProjectBranchesInputSchema,
  async execute({ context, input }) {
    const projects = projectContext(context);
    return jsonResponse({
      comparison: await projects.service.compare(
        projects.organizationId,
        input.projectId,
        projectPrincipal(projects),
        input.baseRef,
        input.compareRef,
      ),
    });
  },
});
