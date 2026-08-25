import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import {
  projectContext,
  projectPrincipal,
  projectsChanged,
} from "./context.js";

const releaseProjectCheckoutInputSchema = z.object({
  checkoutId: boundedText(160),
});

export const releaseProjectCheckoutTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/projects/checkouts/release",
  operation: {
    operationId: "projects.releaseCheckout",
    summary: "Release a clean isolated checkout",
    description:
      "Removes the worktree only after all changes are committed. It does not delete the branch or its commits.",
  },
  inputSchema: releaseProjectCheckoutInputSchema,
  async execute({ context, input }) {
    const projects = projectContext(context);
    const result = await projects.service.checkouts.releaseCheckout(
      projects.organizationId,
      input.checkoutId,
      projectPrincipal(projects),
    );
    await projectsChanged(projects);
    return jsonResponse(result);
  },
});
