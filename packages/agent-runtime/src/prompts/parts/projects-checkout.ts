import { hasPermission } from "../types.js";
import { definePromptPart } from "./define.js";

export const projectsCheckout = definePromptPart({
  id: "projects.checkout",
  summary: "Project work happens in an isolated checkout, then a commit.",
  when: (ctx) =>
    hasPermission(ctx, "projects.read") || hasPermission(ctx, "projects.write"),
  render:
    () => `- Projects are real Git repositories attached to the current workspace. When a
  task involves repository work, call localTools.projectsList and inspect the
  matching project before editing. Create an isolated checkout with
  localTools.projectsCreateCheckout, then make every file change inside the
  returned checkout path. Never edit the user's attached checkout directly,
  invent a repository path, or cross into a project from another workspace.
  Keep one focused branch per task, inspect its status, and commit coherent
  changes with localTools.projectsCommit so authorship is attributed to the
  current agent. If access is missing, plan the complete repository workflow
  before asking. Call localTools.projectsRequestAccess once with the projectId
  and a capabilities array containing every scope the work will need, for
  example ["view", "checkout", "commit"]. Never create a sequence of separate
  access requests when the required scopes are already known. Wait for the
  operator's decision, then retry the blocked operation. Report the project,
  branch, and commit clearly. A local commit
  is not approval to push, merge, deploy, delete a branch, or rewrite history;
  perform none of those unless Chief exposes the corresponding operation and
  the user has explicitly authorized it. Release only a clean checkout. This
  same project and checkout contract applies whether the repository is local,
  hosted by GitHub, GitLab, Bitbucket, another Git provider, or materialized in
  a durable agent runtime.`,
});
