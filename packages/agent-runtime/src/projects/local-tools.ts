import type { ProjectCapability, ProjectPrincipal } from "../types.js";
import type { ProjectGitService } from "./git-service.js";
import { projectCapabilityLevels } from "../project-types.js";

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

function requiredProjectCapabilities(input: unknown): ProjectCapability[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error(
      `capabilities must be a non-empty array containing one or more of: ${projectCapabilityLevels.join(", ")}.`,
    );
  }
  const capabilities = [...new Set(input)];
  if (
    capabilities.some(
      (capability) =>
        typeof capability !== "string" ||
        !projectCapabilityLevels.includes(capability as ProjectCapability),
    )
  ) {
    throw new Error(
      `Every requested capability must be one of: ${projectCapabilityLevels.join(", ")}.`,
    );
  }
  return capabilities as ProjectCapability[];
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
          "Returns every Git project attached to this workspace, with the repository's current state and active isolated agent checkouts. Projects you cannot view yet still appear so you can discover their id, but their repository state stays hidden. If a project is not accessible, request access with projects.requestAccess.",
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
    "/local-tools/projects/diff": {
      post: {
        operationId: "projects.diff",
        summary: "Compare two branches with a bounded diff",
        description:
          "Returns merge status, commit list, and a bounded combined diff between a base and compare ref. Inspect this before publishing work.",
        requestBody: body("ProjectBranchCompareInput"),
        responses: { "200": { description: "Branch comparison" } },
      },
    },
    "/local-tools/projects/checkouts/publish": {
      post: {
        operationId: "projects.publish",
        summary: "Publish one owned branch through the trusted credential flow",
        description:
          "Pushes the caller's branch to its Git remote with an explicit refspec. Publishing to the default branch is disabled unless an operator explicitly authorizes it.",
        requestBody: body("ProjectPublishInput"),
        responses: { "200": { description: "Published branch" } },
      },
    },
    "/local-tools/projects/checkouts/discard": {
      post: {
        operationId: "projects.discardCheckout",
        summary: "Discard uncommitted checkout changes after confirmation",
        description:
          "Permanently removes uncommitted and untracked changes inside the caller's isolated checkout. Requires explicit confirmation.",
        requestBody: body("ProjectDiscardCheckoutInput"),
        responses: { "200": { description: "Discarded checkout" } },
      },
    },
    "/local-tools/projects/pull-requests": {
      post: {
        operationId: "projects.pullRequest.create",
        summary: "Create a provider pull request when the provider supports it",
        description:
          "Creates a pull request from headBranch to baseBranch. Returns a typed unsupported response for repositories without pull request support.",
        requestBody: body("ProjectPullRequestCreateInput"),
        responses: { "200": { description: "Pull request result" } },
      },
    },
    "/local-tools/projects/pull-requests/status": {
      post: {
        operationId: "projects.pullRequest.status",
        summary: "Read checks and review state for a provider pull request",
        description:
          "Returns a typed unsupported response for repositories without pull request support.",
        requestBody: body("ProjectPullRequestStatusInput"),
        responses: { "200": { description: "Pull request status" } },
      },
    },
    "/local-tools/projects/access-request": {
      post: {
        operationId: "projects.requestAccess",
        summary: "Request all required project scopes in one approval",
        description:
          'Request every scope needed for the intended work at once using capabilities, for example {"projectId":"project-id","capabilities":["view","checkout","commit"]}. Valid scopes are view, checkout, commit, publish, review, and administer. Scopes are cumulative, so approval is stored as the highest requested scope and includes every scope below it. The request stays pending until a workspace operator approves or denies it; nothing is granted automatically. After approval, retry the blocked operation.',
        requestBody: body("ProjectAccessRequestInput"),
        responses: { "200": { description: "Pending access request" } },
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
  ProjectBranchCompareInput: {
    type: "object",
    required: ["projectId", "baseRef", "compareRef"],
    properties: {
      projectId: { type: "string" },
      baseRef: { type: "string", description: "Base branch to compare from" },
      compareRef: {
        type: "string",
        description: "Branch whose changes are being reviewed",
      },
    },
  },
  ProjectPublishInput: {
    type: "object",
    required: ["checkoutId"],
    properties: {
      checkoutId: { type: "string" },
      targetBranch: {
        type: "string",
        description: "Optional remote branch. Defaults to the checkout branch.",
      },
      correlationId: {
        type: "string",
        description:
          "Idempotency key that ties a retry to the original publish",
      },
    },
  },
  ProjectDiscardCheckoutInput: {
    type: "object",
    required: ["checkoutId", "confirmed"],
    properties: {
      checkoutId: { type: "string" },
      confirmed: {
        type: "boolean",
        description: "Must be true; uncommitted changes are destroyed",
      },
    },
  },
  ProjectPullRequestCreateInput: {
    type: "object",
    required: ["projectId", "title", "headBranch", "baseBranch"],
    properties: {
      projectId: { type: "string" },
      title: { type: "string", maxLength: 240 },
      description: { type: "string", maxLength: 2000 },
      headBranch: { type: "string" },
      baseBranch: { type: "string" },
    },
  },
  ProjectPullRequestStatusInput: {
    type: "object",
    required: ["projectId", "ref"],
    properties: {
      projectId: { type: "string" },
      ref: {
        type: "string",
        description: "Branch or commit to read checks for",
      },
    },
  },
  ProjectAccessRequestInput: {
    type: "object",
    required: ["projectId", "capabilities"],
    properties: {
      projectId: { type: "string" },
      capabilities: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: {
          type: "string",
          enum: [
            "view",
            "checkout",
            "commit",
            "publish",
            "review",
            "administer",
          ],
        },
        description:
          "Every scope needed for the intended work. Request them together rather than creating sequential requests.",
      },
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
  if (path === "/local-tools/projects/diff") {
    return {
      handled: true,
      value: {
        comparison: await context.service.compare(
          organizationId,
          requiredString(body.projectId, "projectId", 160),
          principal,
          requiredString(body.baseRef, "baseRef"),
          requiredString(body.compareRef, "compareRef"),
        ),
      },
    };
  }
  if (path === "/local-tools/projects/checkouts/publish") {
    const correlationId = optionalString(body.correlationId, 160);
    const targetBranch = optionalString(body.targetBranch);
    const result = await context.service.checkouts.publish(
      organizationId,
      requiredString(body.checkoutId, "checkoutId", 160),
      principal,
      {
        ...(targetBranch ? { targetBranch } : {}),
        ...(correlationId ? { correlationId } : {}),
      },
    );
    await context.onProjectsChanged?.();
    return { handled: true, value: result };
  }
  if (path === "/local-tools/projects/checkouts/discard") {
    const result = await context.service.checkouts.discard(
      organizationId,
      requiredString(body.checkoutId, "checkoutId", 160),
      principal,
      { confirmed: body.confirmed === true },
    );
    await context.onProjectsChanged?.();
    return { handled: true, value: result };
  }
  if (path === "/local-tools/projects/pull-requests") {
    const capability = await context.service.pullRequestCapability(
      organizationId,
      requiredString(body.projectId, "projectId", 160),
      principal,
    );
    if (!capability.supported) return { handled: true, value: capability };
    const pullRequest = await context.service.createPullRequest(
      organizationId,
      requiredString(body.projectId, "projectId", 160),
      principal,
      {
        title: requiredString(body.title, "title", 240),
        ...(optionalString(body.description, 2000)
          ? { description: optionalString(body.description, 2000) }
          : {}),
        headBranch: requiredString(body.headBranch, "headBranch"),
        baseBranch: requiredString(body.baseBranch, "baseBranch"),
      },
    );
    await context.onProjectsChanged?.();
    return { handled: true, value: pullRequest };
  }
  if (path === "/local-tools/projects/pull-requests/status") {
    const capability = await context.service.pullRequestCapability(
      organizationId,
      requiredString(body.projectId, "projectId", 160),
      principal,
    );
    if (!capability.supported) return { handled: true, value: capability };
    const status = await context.service.pullRequestStatus(
      organizationId,
      requiredString(body.projectId, "projectId", 160),
      principal,
      requiredString(body.ref, "ref"),
    );
    return { handled: true, value: status };
  }
  if (path === "/local-tools/projects/access-request") {
    const request = await context.service.administration.requestProjectAccess(
      organizationId,
      requiredString(body.projectId, "projectId", 160),
      context.agentId,
      requiredProjectCapabilities(body.capabilities),
    );
    await context.onProjectsChanged?.();
    return {
      handled: true,
      value: {
        status: request.status,
        requestId: request.id,
        capabilities: request.capabilities,
        message: `Access requested for ${request.capabilities.join(", ")}. A workspace operator must approve this request before those scopes take effect; retry the blocked operation afterward.`,
      },
    };
  }
  throw new Error("Unknown project operation.");
}
