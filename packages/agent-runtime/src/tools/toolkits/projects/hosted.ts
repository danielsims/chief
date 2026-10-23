import { z } from "zod";

import { defineAgentTool } from "../../definition.js";
import { boundedText, optionalBoundedText } from "../../input.js";

/**
 * Hosted-agent project tools. These expose the workspace's own Git host to a
 * cloud agent: it creates and lists the repositories it can work in and
 * publishes its working tree back as a commit.
 */
export const createProjectDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/projects",
  operation: {
    operationId: "projects.create",
    summary: "Create project",
    description:
      "Creates a new Git repository hosted by this workspace and adds it as a project, seeded with a README so it can be cloned straight away. Use this whenever someone asks for a new repo or project. No outside Git provider is needed.",
  },
  inputSchema: z.object({
    name: boundedText(64),
    description: optionalBoundedText(500),
  }),
});

export const checkoutProjectDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/projects/checkout",
  operation: {
    operationId: "projects.checkout",
    summary: "Check out a workspace Git project",
    description:
      "Clones a workspace repository onto your computer at /workspace/<repo> so you can read and change its files. Returns the path. Safe to call again: an existing checkout is reused.",
  },
  inputSchema: z.object({
    repo: boundedText(128),
  }),
});

export const listProjectsDefinition = defineAgentTool({
  method: "GET",
  path: "/local-tools/projects",
  operation: {
    operationId: "projects.list",
    summary: "List projects",
    description:
      "Lists the Git repositories this workspace hosts, with the repository slug used to clone and publish them.",
  },
  querySchema: z.object({}),
});

export const publishProjectDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/projects/publish",
  operation: {
    operationId: "projects.publish",
    summary: "Publish work to a workspace Git repository",
    description:
      "Commits the current files of a cloned project repository back to the workspace's own Git host so the work is durable and reviewable. Publish once you have finished a coherent piece of work, with a clear commit message.",
  },
  inputSchema: z.object({
    repo: optionalBoundedText(128),
    message: boundedText(2_000),
  }),
});
