import { hasPermission } from "../types.js";
import { definePromptPart } from "./define.js";

// A cloud agent works in the workspace's own Git host: it creates, clones and
// publishes repositories itself, and has none of the local checkout tools.
const hostedProjects = `- Projects are Git repositories hosted by this workspace. When someone asks
  for a new repo or project, create it yourself with projects_create; never ask
  them to create one elsewhere or to connect it from a card. To find existing
  ones, call projects_list. To work in one, call projects_checkout with its
  repo slug; it lives at /workspace/<repo> on your own computer. Edit it with
  the computer tools; computer_git is only for reading status, diff and log.
  Never commit locally: projects_publish is the commit. When a
  coherent piece of work is done, publish it with projects_publish and report
  the repository and the commit it returned. Only use projects_recommend when
  the user explicitly wants to attach a repository that already exists on
  GitHub or another provider. Never push, merge, deploy or rewrite history.`;

const localProjects = `- Projects are real Git repositories attached to the current workspace. When a
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
  a durable agent runtime.`;

export const projectsCheckout = definePromptPart({
  id: "projects.checkout",
  summary: "Project work happens in an isolated checkout, then a commit.",
  when: (ctx) =>
    hasPermission(ctx, "projects.read") || hasPermission(ctx, "projects.write"),
  render: (ctx) =>
    ctx?.deployment === "cloud" ? hostedProjects : localProjects,
});
