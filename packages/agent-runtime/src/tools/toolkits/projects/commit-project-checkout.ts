import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import {
  projectContext,
  projectPrincipal,
  projectsChanged,
} from "./context.js";

const commitProjectCheckoutInputSchema = z.object({
  checkoutId: boundedText(160),
  message: boundedText(240),
});

export const commitProjectCheckoutTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/projects/checkouts/commit",
  operation: {
    operationId: "projects.commit",
    summary: "Commit this agent's checkout changes",
    description:
      "Stages and commits changes only inside the caller's isolated checkout. The commit is attributed to the agent via Chief and is not pushed or merged.",
  },
  inputSchema: commitProjectCheckoutInputSchema,
  async execute({ context, input }) {
    const projects = projectContext(context);
    const result = await projects.service.checkouts.commit(
      projects.organizationId,
      input.checkoutId,
      input.message,
      projectPrincipal(projects),
    );
    await projectsChanged(projects);
    return jsonResponse(result);
  },
});
