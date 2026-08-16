import type { ProjectPersistence } from "./store.js";
import { ProjectAuthorizationService } from "./authorization.js";
import { ProjectGitService } from "./git-service.js";

/** Composes the project services behind one authorization seam. */
export function createProjectServices(
  projectStore: ProjectPersistence,
): ProjectGitService {
  const projects: ProjectGitService = new ProjectGitService(projectStore, {
    authorization: new ProjectAuthorizationService(
      projectStore.grants,
      async (organizationId: string) => [
        await projects.operatorPrincipal(organizationId),
      ],
    ),
  });
  return projects;
}
