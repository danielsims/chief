import { hasPermission } from "../types.js";
import { definePromptPart } from "./define.js";

// A cloud agent works in the workspace's own Git host: it creates, clones and
// publishes repositories itself, and has none of the local checkout tools.
const hostedProjects = `## Repository work

Repositories live in this workspace's own Git host. When someone wants a new repository, create it yourself with projects_create rather than asking them to set one up elsewhere. Find existing ones with projects_list.

To work in a repository, call projects_checkout with its slug. It appears at /workspace/<repo> on your computer, where you edit it with the computer tools. computer_git is only for reading status, diffs and history.

projects_publish is the commit, so don't commit locally. When a coherent piece of work is done, publish it and share the repository and the commit it returned. Use projects_recommend only when the person wants to attach a repository that already exists on GitHub or another provider. Never push, merge, deploy or rewrite history.`;

const localProjects = `## Repository work

Repositories attached to this workspace are listed by projects_list. Before changing one, review it with projects_inspect, then create your own checkout with projects_create_checkout and make every edit there. Never edit the person's own copy, guess a repository path or work in another workspace's project.

Keep each piece of work on its own focused branch. Read the repository's instructions, follow its conventions and run the checks that cover what you changed. When you're done, share the repository, the branch, the diff and what you tested.

A commit doesn't give you permission to push, merge, deploy, delete branches or rewrite history. Only do those when Chief provides a tool for it and the person has agreed.`;

export const repositoryWork = definePromptPart({
  id: "repository-work",
  summary: "Repository work happens in an isolated checkout.",
  when: (ctx) =>
    hasPermission(ctx, "projects.read") ||
    hasPermission(ctx, "projects.write") ||
    ctx.includeAll === true,
  render: (ctx) =>
    ctx?.deployment === "cloud" ? hostedProjects : localProjects,
});
