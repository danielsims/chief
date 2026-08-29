import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { projectContext, projectPrincipal } from "./context.js";

const getProjectCheckoutStatusInputSchema = z.object({
  checkoutId: boundedText(160),
});

export const getProjectCheckoutStatusTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/projects/checkouts/status",
  operation: {
    operationId: "projects.checkoutStatus",
    summary: "Inspect an isolated checkout's changes",
  },
  inputSchema: getProjectCheckoutStatusInputSchema,
  async execute({ context, input }) {
    const projects = projectContext(context);
    return jsonResponse(
      await projects.service.checkouts.checkoutStatus(
        projects.organizationId,
        input.checkoutId,
        projectPrincipal(projects),
      ),
    );
  },
});
