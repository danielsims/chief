import {
  listLocalProjectBindings,
  prepareLocalProjectCheckout,
} from "../../projects/local-projects.js";
import { git } from "../../projects/repository-git.js";
import { requiredString } from "../input.js";
import { defineRelayCellTool } from "../tool.js";

export const relayCellProjectTools = [
  defineRelayCellTool(
    "projects.list",
    "projects.read",
    async ({ client, workspaceId }) => {
      const [projects, bindings] = await Promise.all([
        client.listProjects(),
        listLocalProjectBindings(workspaceId),
      ]);
      const localIds = new Set(bindings.map((binding) => binding.projectId));
      return {
        projects: projects.map((project) => ({
          ...project,
          connectedOnThisDevice: localIds.has(project.id),
        })),
      };
    },
  ),
  defineRelayCellTool(
    "projects.inspect",
    "projects.read",
    async ({ client, workspaceId }, input) => {
      const projectId = requiredString(input, "projectId");
      const project = (await client.listProjects()).find(
        (entry) => entry.id === projectId,
      );
      if (!project)
        throw new Error("Project does not belong to this workspace.");
      const binding = (await listLocalProjectBindings(workspaceId)).find(
        (entry) => entry.projectId === projectId,
      );
      if (!binding) return { project, connectedOnThisDevice: false };
      return {
        project,
        connectedOnThisDevice: true,
        status: await git(
          ["status", "--short", "--branch"],
          binding.repositoryPath,
        ),
        branches: await git(["branch", "--list"], binding.repositoryPath),
      };
    },
  ),
  defineRelayCellTool(
    "projects.createCheckout",
    "projects.write",
    async ({ client, workspaceId, agentId }, input) => {
      const projectId = requiredString(input, "projectId");
      if (
        !(await client.listProjects()).some(
          (project) => project.id === projectId,
        )
      )
        throw new Error("Project does not belong to this workspace.");
      if (input.branch || input.baseRef)
        throw new Error(
          "Local cells use a persistent isolated branch per agent based on the connected checkout. Omit branch and baseRef.",
        );
      return await prepareLocalProjectCheckout({
        workspaceId,
        projectId,
        agentId,
      });
    },
  ),
];
