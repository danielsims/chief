import { z } from "zod";

import type { CreateProjectCheckoutInput } from "../../../projects/checkouts.js";
import { boundedText, optionalBoundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import {
  projectContext,
  projectPrincipal,
  projectsChanged,
} from "./context.js";

const createProjectCheckoutInputSchema = z.object({
  projectId: boundedText(160),
  baseRef: optionalBoundedText(240),
  branch: optionalBoundedText(240),
});

export const createProjectCheckoutTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/projects/checkouts",
  operation: {
    operationId: "projects.createCheckout",
    summary: "Create an isolated Git checkout for this agent",
    description:
      "Creates a dedicated branch in a Chief-owned worktree. Make all repository edits there rather than changing the user's attached checkout.",
  },
  inputSchema: createProjectCheckoutInputSchema,
  async execute({ context, input }) {
    const projects = projectContext(context);
    const checkoutInput: CreateProjectCheckoutInput = {
      organizationId: projects.organizationId,
      projectId: input.projectId,
      agentId: projects.agentId,
    };
    if (projects.conversationId) {
      checkoutInput.sessionId = projects.conversationId;
    }
    if (input.baseRef) checkoutInput.baseRef = input.baseRef;
    if (input.branch) checkoutInput.branch = input.branch;
    const checkout = await projects.service.checkouts.createCheckout(
      checkoutInput,
      projectPrincipal(projects),
    );
    await projectsChanged(projects);
    return jsonResponse(checkout);
  },
});
