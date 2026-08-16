import type { ProjectPersistence } from "./store.js";
import { ProjectAuthorizationService } from "./authorization.js";
import { GitCredentialHelperBroker } from "./credential-broker.js";
import { ProjectGitService } from "./git-service.js";

/** Composes the project services behind one authorization seam and broker. */
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
    broker: new GitCredentialHelperBroker(),
  });
  return projects;
}
