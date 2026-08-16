import type { ProjectPrincipal } from "../types.js";
import type { ProjectGitService } from "./git-service.js";

function requiredString(input: unknown, name: string, maximum = 240) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error(`${name} is required.`);
  }
  return input.trim().slice(0, maximum);
}

function optionalString(input: unknown, maximum = 240) {
  return typeof input === "string" && input.trim()
    ? input.trim().slice(0, maximum)
    : undefined;
}

export interface ProjectLocalToolContext {
  service: ProjectGitService;
  organizationId: string;
  agentId: string;
  conversationId?: string;
  onProjectsChanged?: () => void | Promise<void>;
}

function agentPrincipal(context: ProjectLocalToolContext): ProjectPrincipal {
  return { type: "agent", id: context.agentId };
}

export function projectOpenApiPaths(
  body: (schema: string) => Record<string, unknown>,
) {
  return {
    "/local-tools/projects": {
      get: {
        operationId: "projects.list",
        summary: "List the workspace's Git projects",
        description:
          "Returns real repositories attached to this workspace, their current Git state, and active isolated agent checkouts.",
        responses: { "200": { description: "Workspace Git projects" } },
      },
    },
    "/local-tools/projects/inspect": {
      post: {
        operationId: "projects.inspect",
        summary: "Inspect a project's branches, status, and recent commits",
        requestBody: body("ProjectIdInput"),
        responses: { "200": { description: "Current repository snapshot" } },
      },
    },
    "/local-tools/projects/checkouts": {
      post: {
        operationId: "projects.createCheckout",
        summary: "Create an isolated Git checkout for this agent",
        description:
          "Creates a dedicated branch in a Chief-owned worktree. Make all repository edits there rather than changing the user's attached checkout.",
        requestBody: body("ProjectCheckoutInput"),
        responses: { "200": { description: "Created isolated checkout" } },
      },
    },
    "/local-tools/projects/checkouts/status": {
      post: {
        operationId: "projects.checkoutStatus",
        summary: "Inspect an isolated checkout's changes",
        requestBody: body("ProjectCheckoutIdInput"),
        responses: {
          "200": { description: "Checkout status and diff summary" },
        },
      },
    },
    "/local-tools/projects/checkouts/commit": {
      post: {
        operationId: "projects.commit",
        summary: "Commit this agent's checkout changes",
        description:
          "Stages and commits changes only inside the caller's isolated checkout. The commit is attributed to the agent via Chief and is not pushed or merged.",
        requestBody: body("ProjectCommitInput"),
        responses: { "200": { description: "Created Git commit" } },
      },
    },
    "/local-tools/projects/checkouts/release": {
      post: {
        operationId: "projects.releaseCheckout",
        summary: "Release a clean isolated checkout",
        description:
          "Removes the worktree only after all changes are committed. It does not delete the branch or its commits.",
        requestBody: body("ProjectCheckoutIdInput"),
        responses: { "200": { description: "Released checkout" } },
      },
    },
  };
}

export const projectOpenApiSchemas = {
  ProjectIdInput: {
    type: "object",
    required: ["projectId"],
    properties: { projectId: { type: "string" } },
  },
  ProjectCheckoutIdInput: {
    type: "object",
    required: ["checkoutId"],
    properties: { checkoutId: { type: "string" } },
  },
  ProjectCheckoutInput: {
    type: "object",
    required: ["projectId"],
    properties: {
      projectId: { type: "string" },
      baseRef: {
        type: "string",
        description: "Existing branch or commit to start from",
      },
      branch: {
        type: "string",
        description:
          "Optional dedicated branch. Chief generates a collision-resistant chief/<agent>/<id> branch when omitted.",
      },
    },
  },
  ProjectCommitInput: {
    type: "object",
    required: ["checkoutId", "message"],
    properties: {
      checkoutId: { type: "string" },
      message: { type: "string", maxLength: 240 },
    },
  },
} as const;

export async function handleProjectLocalTool(
  request: Request,
  body: Record<string, unknown>,
  context?: ProjectLocalToolContext,
): Promise<{ handled: false } | { handled: true; value: unknown }> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/local-tools/projects")) return { handled: false };
  if (!context) throw new Error("Project tools are unavailable.");

  if (request.method === "GET" && path === "/local-tools/projects") {
    return {
      handled: true,
      value: {
        projects: await context.service.list(
          context.organizationId,
          agentPrincipal(context),
        ),
      },
    };
  }
  if (request.method !== "POST")
    throw new Error("Unsupported project operation.");
  const organizationId = context.organizationId;
  const principal = agentPrincipal(context);

  if (path === "/local-tools/projects/inspect") {
    return {
      handled: true,
      value: await context.service.inspect(
        organizationId,
        requiredString(body.projectId, "projectId", 160),
        principal,
      ),
    };
  }
  if (path === "/local-tools/projects/checkouts") {
    const baseRef = optionalString(body.baseRef);
    const branch = optionalString(body.branch);
    const checkout = await context.service.checkouts.createCheckout(
      {
        organizationId,
        projectId: requiredString(body.projectId, "projectId", 160),
        agentId: context.agentId,
        ...(context.conversationId
          ? { sessionId: context.conversationId }
          : {}),
        ...(baseRef ? { baseRef } : {}),
        ...(branch ? { branch } : {}),
      },
      principal,
    );
    await context.onProjectsChanged?.();
    return { handled: true, value: checkout };
  }
  if (path === "/local-tools/projects/checkouts/status") {
    return {
      handled: true,
      value: await context.service.checkouts.checkoutStatus(
        organizationId,
        requiredString(body.checkoutId, "checkoutId", 160),
        principal,
      ),
    };
  }
  if (path === "/local-tools/projects/checkouts/commit") {
    const result = await context.service.checkouts.commit(
      organizationId,
      requiredString(body.checkoutId, "checkoutId", 160),
      requiredString(body.message, "message", 240),
      principal,
    );
    await context.onProjectsChanged?.();
    return { handled: true, value: result };
  }
  if (path === "/local-tools/projects/checkouts/release") {
    const result = await context.service.checkouts.releaseCheckout(
      organizationId,
      requiredString(body.checkoutId, "checkoutId", 160),
      principal,
    );
    await context.onProjectsChanged?.();
    return { handled: true, value: result };
  }
  throw new Error("Unknown project operation.");
}
