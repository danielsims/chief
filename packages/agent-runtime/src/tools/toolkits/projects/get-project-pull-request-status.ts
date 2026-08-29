import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { projectContext, projectPrincipal } from "./context.js";

const getProjectPullRequestStatusInputSchema = z.object({
  projectId: boundedText(160),
  ref: boundedText(240),
});

export const getProjectPullRequestStatusTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/projects/pull-requests/status",
  operation: {
    operationId: "projects.pullRequest.status",
    summary: "Read checks and review state for a provider pull request",
    description:
      "Returns a typed unsupported response for repositories without pull request support.",
  },
  inputSchema: getProjectPullRequestStatusInputSchema,
  async execute({ context, input }) {
    const projects = projectContext(context);
    const principal = projectPrincipal(projects);
    const capability = await projects.service.pullRequestCapability(
      projects.organizationId,
      input.projectId,
      principal,
    );
    if (!capability.supported) return jsonResponse(capability);
    return jsonResponse(
      await projects.service.pullRequestStatus(
        projects.organizationId,
        input.projectId,
        principal,
        input.ref,
      ),
    );
  },
});
