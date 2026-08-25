import { z } from "zod";

import { boundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import {
  projectContext,
  projectPrincipal,
  projectsChanged,
} from "./context.js";

const discardProjectCheckoutInputSchema = z.object({
  checkoutId: boundedText(160),
  confirmed: z.literal(true),
});

export const discardProjectCheckoutTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/projects/checkouts/discard",
  operation: {
    operationId: "projects.discardCheckout",
    summary: "Discard uncommitted checkout changes after confirmation",
    description:
      "Permanently removes uncommitted and untracked changes inside the caller's isolated checkout. Requires explicit confirmation.",
  },
  inputSchema: discardProjectCheckoutInputSchema,
  async execute({ context, input }) {
    const projects = projectContext(context);
    const result = await projects.service.checkouts.discard(
      projects.organizationId,
      input.checkoutId,
      projectPrincipal(projects),
      { confirmed: input.confirmed },
    );
    await projectsChanged(projects);
    return jsonResponse(result);
  },
});
