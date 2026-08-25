import { z } from "zod";

import { boundedText, optionalBoundedText } from "../../input.js";
import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import {
  projectContext,
  projectPrincipal,
  projectsChanged,
} from "./context.js";

interface ProjectPullRequestInput {
  title: string;
  description?: string;
  headBranch: string;
  baseBranch: string;
}

const createProjectPullRequestInputSchema = z.object({
  projectId: boundedText(160),
  title: boundedText(240),
  description: optionalBoundedText(2_000),
  headBranch: boundedText(240),
  baseBranch: boundedText(240),
});

export const createProjectPullRequestTool = defineLocalTool({
  method: "POST",
  path: "/local-tools/projects/pull-requests",
  operation: {
    operationId: "projects.pullRequest.create",
    summary: "Create a provider pull request when the provider supports it",
    description:
      "Creates a pull request from headBranch to baseBranch. Returns a typed unsupported response for repositories without pull request support.",
  },
  inputSchema: createProjectPullRequestInputSchema,
  async execute({ context, input }) {
    const projects = projectContext(context);
    const principal = projectPrincipal(projects);
    const capability = await projects.service.pullRequestCapability(
      projects.organizationId,
      input.projectId,
      principal,
    );
    if (!capability.supported) return jsonResponse(capability);
    const pullRequestInput: ProjectPullRequestInput = {
      title: input.title,
      headBranch: input.headBranch,
      baseBranch: input.baseBranch,
    };
    if (input.description) pullRequestInput.description = input.description;
    const pullRequest = await projects.service.createPullRequest(
      projects.organizationId,
      input.projectId,
      principal,
      pullRequestInput,
    );
    await projectsChanged(projects);
    return jsonResponse(pullRequest);
  },
});
