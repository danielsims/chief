import type {
  ProjectCapability,
  ProjectGrantConstraint,
  ProjectPrincipal,
} from "../project-types.js";
import type { ProjectGrantStore } from "./store.js";
import { projectCapabilityLevels } from "../project-types.js";

/** A project operation was not permitted by the principal's grants. */
export class ProjectAuthorizationError extends Error {
  readonly code = "project_authorization_denied";
  constructor(
    readonly organizationId: string,
    readonly projectId: string,
    readonly principal: ProjectPrincipal,
    readonly capability: ProjectCapability,
    readonly reason: string,
  ) {
    super(
      `This principal is not authorized to ${capability} this project. ${reason}`,
    );
    this.name = "ProjectAuthorizationError";
  }
}

function capabilityLevel(capability: ProjectCapability) {
  return projectCapabilityLevels.indexOf(capability);
}

/** True when a grant for `granted` also covers the requested capability. */
export function grantCovers(
  granted: ProjectCapability,
  requested: ProjectCapability,
) {
  return capabilityLevel(granted) >= capabilityLevel(requested);
}

/** Matches one `*` wildcard against a branch name, without regex injection. */
export function branchPatternMatches(pattern: string, branch: string) {
  const star = pattern.indexOf("*");
  if (star < 0) return pattern === branch;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return (
    branch.startsWith(prefix) &&
    (suffix.length === 0 || branch.endsWith(suffix))
  );
}

/** Branch and expiry constraints restrict a grant without denying it outright. */
export function grantConstraintAllows(
  constraint: ProjectGrantConstraint | undefined,
  targetRef: string | undefined,
): string | undefined {
  if (!constraint) return undefined;
  if (constraint.expiresAt !== undefined && Date.now() > constraint.expiresAt) {
    return "This grant has expired.";
  }
  if (
    constraint.branches?.length &&
    targetRef &&
    !constraint.branches.some((pattern) =>
      branchPatternMatches(pattern, targetRef),
    )
  ) {
    return `This grant does not cover the branch ${targetRef}.`;
  }
  return undefined;
}

/**
 * The single authorization gate for project operations. Effective access is
 * the intersection of the principal's project grants and, for local write
 * operations, their constraints. Provider and repository policy are enforced
 * separately at publish time. Denial is fail-closed: no matching grant means
 * no access unless the principal is an operator of the workspace.
 */
export class ProjectAuthorizationService {
  constructor(
    private readonly grants: ProjectGrantStore,
    private readonly resolveOperators: (
      organizationId: string,
    ) => Promise<ProjectPrincipal[]> | ProjectPrincipal[],
  ) {}

  async authorize(input: {
    organizationId: string;
    projectId: string;
    principal: ProjectPrincipal;
    capability: ProjectCapability;
    targetRef?: string;
  }): Promise<void> {
    const { organizationId, projectId, principal, capability, targetRef } =
      input;
    const [principalGrants, operators] = await Promise.all([
      this.grants.grants(organizationId, projectId, {
        type: principal.type,
        id: principal.id,
      }),
      this.resolveOperators(organizationId),
    ]);
    const isOperator = operators.some(
      (operator) =>
        operator.type === principal.type && operator.id === principal.id,
    );
    if (isOperator) return;
    for (const grant of principalGrants) {
      if (
        grant.capability !== capability &&
        !grantCovers(grant.capability, capability)
      ) {
        continue;
      }
      const blocked = grantConstraintAllows(grant.constraintJson, targetRef);
      if (!blocked) return;
      throw new ProjectAuthorizationError(
        organizationId,
        projectId,
        principal,
        capability,
        blocked,
      );
    }
    throw new ProjectAuthorizationError(
      organizationId,
      projectId,
      principal,
      capability,
      "No matching project grant exists.",
    );
  }

  /**
   * Creating a project is a workspace administration operation. Only the
   * workspace's operators may do it; a project grant cannot exist yet because
   * the project does not.
   */
  async authorizeCreation(
    organizationId: string,
    principal: ProjectPrincipal,
  ): Promise<void> {
    const operators = await this.resolveOperators(organizationId);
    const isOperator = operators.some(
      (operator) =>
        operator.type === principal.type && operator.id === principal.id,
    );
    if (!isOperator) {
      throw new ProjectAuthorizationError(
        organizationId,
        "",
        principal,
        "administer",
        "Only a workspace operator can create or manage projects.",
      );
    }
  }
}
