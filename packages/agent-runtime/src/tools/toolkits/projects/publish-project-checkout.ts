import { z } from "zod";

import type { PublishCheckoutInput } from "../../../projects/checkouts.js";
import { boundedText, optionalBoundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import {
  projectContext,
  projectPrincipal,
  projectsChanged,
} from "./context.js";

const publishProjectCheckoutInputSchema = z.object({
  checkoutId: boundedText(160),
  targetBranch: optionalBoundedText(240),
  correlationId: optionalBoundedText(160),
});

export const publishProjectCheckoutTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/projects/checkouts/publish",
  operation: {
    operationId: "projects.publish",
    summary: "Publish one owned branch through the trusted credential flow",
    description:
      "Pushes the caller's branch to its Git remote with an explicit refspec. Publishing to the default branch is disabled unless an operator explicitly authorizes it.",
  },
  inputSchema: publishProjectCheckoutInputSchema,
  async execute({ context, input }) {
    const projects = projectContext(context);
    const publishInput: PublishCheckoutInput = {};
    if (input.targetBranch) publishInput.targetBranch = input.targetBranch;
    if (input.correlationId) publishInput.correlationId = input.correlationId;
    const result = await projects.service.checkouts.publish(
      projects.organizationId,
      input.checkoutId,
      projectPrincipal(projects),
      publishInput,
    );
    await projectsChanged(projects);
    return jsonResponse(result);
  },
});
