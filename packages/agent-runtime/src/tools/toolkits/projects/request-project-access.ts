import { z } from "zod";

import { projectCapabilityLevels } from "../../../project-types.js";
import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { projectContext, projectsChanged } from "./context.js";

export const requestProjectAccessInputSchema = z.object({
  projectId: boundedText(160),
  capabilities: z
    .array(z.enum(projectCapabilityLevels))
    .min(1)
    .transform((capabilities) => [...new Set(capabilities)]),
});

export const requestProjectAccessTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/projects/access-request",
  operation: {
    operationId: "projects.requestAccess",
    summary: "Request all required project scopes in one approval",
    description:
      'Request every scope needed for the intended work at once using capabilities, for example {"projectId":"project-id","capabilities":["view","checkout","commit"]}. Valid scopes are view, checkout, commit, publish, review, and administer. Scopes are cumulative, so approval is stored as the highest requested scope and includes every scope below it. The request stays pending until a workspace operator approves or denies it; nothing is granted automatically. After approval, retry the blocked operation.',
  },
  inputSchema: requestProjectAccessInputSchema,
  async execute({ context, input }) {
    const projects = projectContext(context);
    const request = await projects.service.administration.requestProjectAccess(
      projects.organizationId,
      input.projectId,
      projects.agentId,
      input.capabilities,
    );
    await projectsChanged(projects);
    return jsonResponse({
      status: request.status,
      requestId: request.id,
      capabilities: request.capabilities,
      message: `Access requested for ${request.capabilities.join(", ")}. A workspace operator must approve this request before those scopes take effect; retry the blocked operation afterward.`,
    });
  },
});
