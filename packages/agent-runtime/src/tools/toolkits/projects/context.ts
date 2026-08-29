import type { LocalToolContext } from "../../../local-tool-context.js";
import type { ProjectGitService } from "../../../projects/git-service.js";
import type { ProjectPrincipal } from "../../../types.js";

export interface ProjectLocalToolContext {
  service: ProjectGitService;
  organizationId: string;
  agentId: string;
  conversationId?: string;
  onProjectsChanged?: () => void | Promise<void>;
}

export function projectContext(context: LocalToolContext) {
  if (!context.projects) throw new Error("Project tools are unavailable.");
  return context.projects;
}

export function projectPrincipal(
  context: ProjectLocalToolContext,
): ProjectPrincipal {
  return { type: "agent", id: context.agentId };
}

export async function projectsChanged(context: ProjectLocalToolContext) {
  await context.onProjectsChanged?.();
}
