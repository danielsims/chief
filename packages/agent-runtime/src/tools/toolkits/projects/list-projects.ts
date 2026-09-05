import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";
import { projectContext, projectPrincipal } from "./context.js";

export const listProjectsTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/projects",
  operation: {
    operationId: "projects.list",
    summary: "List the workspace's Git projects",
    description:
      "Returns every Git project attached to this workspace, with the repository's current state and active isolated agent checkouts. Projects you cannot view yet still appear so you can discover their id, but their repository state stays hidden. If a project is not accessible, request access with projects.requestAccess. If the list is empty, publish a connect card with projects.recommend instead of asking the user to paste a URL in chat.",
  },
  async execute({ context }) {
    const projects = projectContext(context);
    return jsonResponse({
      projects: await projects.service.list(
        projects.organizationId,
        projectPrincipal(projects),
      ),
    });
  },
});
