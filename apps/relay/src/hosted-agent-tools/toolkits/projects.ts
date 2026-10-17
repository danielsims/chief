import { z } from "zod";

import type { AgentComputer } from "@chief/agent-computer";
import type { Principal, WorkspaceId } from "@chief/relay-contracts";
import {
  gitRemoteUrl,
  gitRepoSlug as projectRepoSlug,
} from "@chief/agent-runtime/git-objects";
import { parseJsonObject, relayErrorSchema } from "@chief/relay-contracts";

import { executeHostedAgentProjectTool } from "../../hosted-agent-project-tools";
import {
  checkoutWorkspaceRepository,
  relayOrigin,
} from "../../hosted-project-checkout";
import { HttpError } from "../../http";
import { withTrustedContext } from "../../internal-context";
import { gitRepoSlug, isSafeGitRepoSlug } from "../../workspace-git-store";
import { optionalString, requiredString } from "../input";
import { defineHostedAgentTool } from "../tool";

// Keep a publish request bounded so a huge working tree cannot exhaust the
// relay's memory or the Durable Object's SQL row limits.
const MAX_PUBLISH_BYTES = 6_000_000;
const MAX_PUBLISH_FILES = 5_000;

export const hostedProjectTools = [
  defineHostedAgentTool(
    "projects.recommend",
    async ({ env, job }, input) =>
      await executeHostedAgentProjectTool(
        env,
        job,
        "projects.recommend",
        input,
      ),
    { effect: "idempotent" },
  ),
  defineHostedAgentTool(
    "projects.create",
    async ({ computer, computerEnabled, env, job, principal }, input) => {
      const name = requiredString(input, "name");
      const description = optionalString(input, "description");
      const repo = projectRepoSlug(name);
      // The remote is built here from the relay's own configuration, so the
      // model can never point a project at a URL of its choosing.
      const remoteUrl = gitRemoteUrl(relayOrigin(env), job.workspaceId, repo);
      let project: z.infer<typeof createdProjectSchema>;
      try {
        project = createdProjectSchema.parse(
          await callWorkspace(env, job, principal, "data-project-create", {
            method: "POST",
            body: JSON.stringify({
              name,
              ...(description ? { description } : undefined),
              repositoryKind: "cloned",
              providerId: "chief-git",
              canonicalRemoteUrl: remoteUrl,
              defaultBranch: "main",
              repositoryFiles: [
                {
                  path: "README.md",
                  content: `# ${name}\n${description ? `\n${description}\n` : ""}`,
                },
              ],
            }),
          }),
        );
      } catch (error) {
        if (error instanceof HttpError && error.status === 409) {
          throw new HttpError(
            409,
            "project_exists",
            `A project with the repository "${repo}" already exists in this workspace. Use it, or create the project under a different name.`,
          );
        }
        throw error;
      }
      // Check the new repository out straight away when this turn can use the
      // computer, so the agent can start working in it. The project exists
      // either way; a failed checkout is reported, not hidden.
      let checkout: string | null = null;
      let checkoutError: string | null = null;
      if (computerEnabled) {
        try {
          checkout =
            (await checkoutWorkspaceRepository(
              env,
              job,
              principal,
              computer,
              repo,
            )) ?? null;
        } catch (error) {
          checkoutError =
            error instanceof Error ? error.message : "The clone failed.";
        }
      }
      return {
        created: true,
        projectId: project.id,
        name: project.name,
        repo,
        remoteUrl,
        defaultBranch: "main",
        checkout,
        ...(checkoutError ? { checkoutError } : undefined),
      };
    },
    { effect: "non_replayable" },
  ),
  defineHostedAgentTool(
    "projects.checkout",
    async ({ computer, env, job, principal }, input) => {
      const repo = gitRepoSlug(requiredString(input, "repo"));
      if (!isSafeGitRepoSlug(repo)) {
        throw new HttpError(
          400,
          "git_repository_invalid",
          "Name a workspace repository slug from projects_list.",
        );
      }
      const path = await checkoutWorkspaceRepository(
        env,
        job,
        principal,
        computer,
        repo,
      );
      if (!path) {
        throw new HttpError(
          409,
          "computer_unavailable",
          "This computer cannot clone repositories.",
        );
      }
      return { repo, path };
    },
    { effect: "idempotent", requiresComputer: true },
  ),
  defineHostedAgentTool(
    "projects.list",
    // What is on each repository's main branch, by path. The file list is
    // updated on every publish, so this is how an agent checks its own work.
    async ({ env, job, principal }) => {
      const { projects = [] } = projectsListSchema.parse(
        await callWorkspace(env, job, principal, "data-projects-list", {
          method: "POST",
        }),
      );
      return {
        projects: projects.map((project) => ({
          name: project.name,
          repo: repoFromRemote(project.canonicalRemoteUrl),
          defaultBranch: project.defaultBranch,
          files: project.repositoryFiles?.map((file) => file.path) ?? [],
        })),
      };
    },
    { effect: "read_only" },
  ),
  defineHostedAgentTool(
    "projects.publish",
    async ({ computer, env, job, principal }, input) => {
      const requested = optionalString(input, "repo");
      const repo = gitRepoSlug(
        requested ?? (await singleProjectRepo(env, job, principal)),
      );
      if (!isSafeGitRepoSlug(repo)) {
        throw new HttpError(
          400,
          "git_repository_invalid",
          "Name a workspace repository slug from projects_list.",
        );
      }
      const message = requiredString(input, "message");
      const dir = `/workspace/${repo}`;
      const files = await readWorkspaceTree(computer, dir);
      // Publishing replaces main with this tree, so an empty or missing
      // checkout would wipe the repository.
      if (files.length === 0) {
        throw new HttpError(
          409,
          "git_checkout_empty",
          `${dir} has no files to publish. Call projects_checkout first and make your change there.`,
        );
      }
      const result = publishResultSchema.parse(
        await callWorkspace(env, job, principal, "git-publish", {
          method: "POST",
          body: JSON.stringify({ repo, message, files }),
        }),
      );
      // Replace the local checkout with what was just published, so the
      // agent's copy and main are always the same commit. There is one line
      // of history: the workspace host's.
      let synced = true;
      try {
        await computer.remove(dir, true);
        await checkoutWorkspaceRepository(env, job, principal, computer, repo);
      } catch {
        synced = false;
      }
      return {
        repo,
        commit: result.commitSha ?? null,
        files: files.length,
        checkout: synced
          ? `${dir} now matches this commit on main.`
          : `The commit is on main, but ${dir} could not be refreshed. Call projects_checkout before further changes.`,
      };
    },
    { effect: "non_replayable", requiresComputer: true },
  ),
];

async function callWorkspace(
  env: Env,
  job: { workspaceId: WorkspaceId },
  principal: Principal,
  operation: string,
  init: { method: string; body?: string },
): Promise<object> {
  const stub = env.WORKSPACES.get(env.WORKSPACES.idFromName(job.workspaceId));
  const response = await stub.fetch(
    withTrustedContext(
      new Request("https://workspace.internal/git", {
        method: init.method,
        ...(init.body ? { body: init.body } : undefined),
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": operation,
        },
      }),
      {
        principal,
        requestId: crypto.randomUUID(),
        workspaceId: job.workspaceId,
      },
    ),
  );
  if (!response.ok) {
    // Surface the workspace's own error so a refusal (409, 403, 404) reaches
    // the agent as a recoverable tool error it can act on.
    const detail = await response.text().catch(() => "");
    const parsed = (() => {
      try {
        return relayErrorSchema.safeParse(JSON.parse(detail));
      } catch {
        return undefined;
      }
    })();
    throw new HttpError(
      response.status,
      parsed?.success ? parsed.data.error.code : "workspace_operation_failed",
      parsed?.success
        ? parsed.data.error.message
        : `The workspace operation failed (${response.status}).`,
    );
  }
  const body = parseJsonObject(await response.json());
  if (!body) throw new Error("The workspace Git response was malformed.");
  return body;
}

const createdProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const publishResultSchema = z.object({
  commitSha: z.string().optional(),
  parentSha: z.string().optional(),
});

const projectsListSchema = z.object({
  projects: z
    .array(
      z.object({
        name: z.string(),
        canonicalRemoteUrl: z.string().optional(),
        defaultBranch: z.string().optional(),
        repositoryFiles: z.array(z.object({ path: z.string() })).optional(),
      }),
    )
    .optional(),
});

function repoFromRemote(remote = "") {
  return (
    remote
      .replace(/\.git$/u, "")
      .split("/")
      .at(-1) ?? ""
  );
}

async function singleProjectRepo(
  env: Env,
  job: { workspaceId: WorkspaceId },
  principal: Principal,
) {
  const data = projectsListSchema.parse(
    await callWorkspace(env, job, principal, "data-projects-list", {
      method: "POST",
    }),
  );
  const projects = data.projects ?? [];
  if (projects.length !== 1) {
    throw new Error(
      "Name the repository to publish to, or attach exactly one project.",
    );
  }
  const slug = repoFromRemote(projects[0]?.canonicalRemoteUrl);
  if (!slug) throw new Error("This project has no workspace Git repository.");
  return slug;
}

async function readWorkspaceTree(
  computer: AgentComputer,
  directory: string,
): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = [];
  let bytes = 0;
  const walk = async (path: string) => {
    const entries = await computer.list(path);
    for (const entry of entries) {
      if (entry.kind === "directory") {
        if (entry.path === `${directory}/.git`) continue;
        await walk(entry.path);
        continue;
      }
      if (entry.kind !== "file") continue;
      const relative = entry.path.slice(directory.length + 1);
      if (relative.startsWith(".git/")) continue;
      const content = await computer.readText(entry.path);
      bytes += content.length;
      if (bytes > MAX_PUBLISH_BYTES) {
        throw new Error("This working tree is too large to publish from here.");
      }
      if (files.length >= MAX_PUBLISH_FILES) {
        throw new Error("This working tree has too many files to publish.");
      }
      files.push({ path: relative, content });
    }
  };
  await walk(directory);
  return files;
}
