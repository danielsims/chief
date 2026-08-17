import type { ExecutorCapability } from "../types.js";

/** Workspace project client messages, kept apart so the protocol stays tidy. */
export type ProjectClientMessage =
  | {
      type: "listProjects";
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "attachProject";
      workspaceId: string;
      requestId: string;
      path: string;
      name?: string;
      description?: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "cloneProject";
      workspaceId: string;
      requestId: string;
      remoteUrl: string;
      name?: string;
      description?: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "browseProject";
      workspaceId: string;
      requestId: string;
      projectId: string;
      ref?: string;
      path?: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "inspectProjectCommit";
      workspaceId: string;
      requestId: string;
      projectId: string;
      ref?: string;
      commit: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "compareProjectBranches";
      workspaceId: string;
      requestId: string;
      projectId: string;
      baseRef: string;
      compareRef: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "publishProjectCheckout";
      workspaceId: string;
      requestId: string;
      checkoutId: string;
      targetBranch?: string;
      correlationId?: string;
      allowDefaultBranch?: boolean;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "discardProjectCheckout";
      workspaceId: string;
      requestId: string;
      checkoutId: string;
      confirmed: boolean;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "createProjectPullRequest";
      workspaceId: string;
      requestId: string;
      projectId: string;
      title: string;
      description?: string;
      headBranch: string;
      baseBranch: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "listProjectAccessRequests";
      workspaceId: string;
      executorCapability: ExecutorCapability;
    }
  | {
      type: "resolveProjectAccessRequest";
      workspaceId: string;
      requestId: string;
      accessRequestId: string;
      decision: "approved" | "denied";
      executorCapability: ExecutorCapability;
    };
