import { z } from "zod";

import type { AgentComputer } from "@chief/agent-computer";
import type { AgentJob, AgentPrincipal } from "@chief/relay-contracts";
import { gitRemoteUrl } from "@chief/agent-runtime/git-objects";
import { isJsonString } from "@chief/relay-contracts";

import { withTrustedContext } from "./internal-context";
import { gitRepoSlug, isSafeGitRepoSlug } from "./workspace-git-store";

/**
 * Clones the workspace project an agent was assigned into its durable
 * workspace, once, so it can read, edit, and commit real files. The clone is
 * authenticated with a short-lived, read-only, repo-scoped token
 * minted by the workspace Durable Object; the agent never sees the workspace
 * secret. A repository already present in the workspace is left untouched.
 */
export async function ensureHostedProjectCheckout(
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  computer: AgentComputer,
) {
  const repo = projectRepo(job);
  if (!repo) return;
  await checkoutWorkspaceRepository(env, job, principal, computer, repo);
}

/**
 * Clones one workspace repository to /workspace/<repo> unless it is already
 * there. Returns the checkout directory, or undefined when the computer
 * cannot clone.
 */
export async function checkoutWorkspaceRepository(
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  computer: AgentComputer,
  repo: string,
) {
  if (!computer.clone) return undefined;
  if (!isSafeGitRepoSlug(repo)) {
    throw new Error("This repository name cannot be checked out.");
  }
  const dir = `/workspace/${repo}`;
  const remote = gitRemoteUrl(relayOrigin(env), job.workspaceId, repo);
  const existing = await checkoutState(computer, dir, remote);
  if (existing === "checkout") return dir;
  if (existing === "other") {
    throw new Error(
      `${dir} already exists but is not a checkout of the workspace repository "${repo}". Move or remove it with computer_execute, then call projects_checkout again.`,
    );
  }
  const token = await mintCloneToken(env, job, principal, repo);
  try {
    await computer.clone({
      url: remote,
      dir,
      headers: { authorization: `Bearer ${token}` },
    });
    // A clone that fetched nothing must fail loudly, never look like success.
    if (!(await hasCommit(computer, dir))) {
      throw new Error(`The clone of "${repo}" fetched no commits.`);
    }
  } catch (error) {
    await computer.remove(dir, true).catch(() => undefined);
    throw error;
  }
  return dir;
}

function projectRepo(job: AgentJob) {
  const value = job.payload.projectRepo;
  if (!isJsonString(value)) return undefined;
  const repo = gitRepoSlug(value);
  return isSafeGitRepoSlug(repo) ? repo : undefined;
}

/** The relay's public origin, from configuration only, never from input. */
export function relayOrigin(env: Env) {
  return (env.RELAY_PUBLIC_URL ?? new URL(env.AUTH_BASE_URL).origin).replace(
    /\/$/u,
    "",
  );
}

/** Whether dir is missing, a working clone of this repository, or other. */
async function checkoutState(
  computer: AgentComputer,
  dir: string,
  remote: string,
) {
  const entries = await computer.list(dir).catch(() => []);
  if (entries.length === 0) return "missing";
  const config = await computer.readText(`${dir}/.git/config`).catch(() => "");
  return config.includes(remote) && (await hasCommit(computer, dir))
    ? "checkout"
    : "other";
}

async function hasCommit(computer: AgentComputer, dir: string) {
  const head = await computer.git(["rev-parse", "HEAD"], dir);
  return head.exitCode === 0 && /^[0-9a-f]{40}$/u.test(head.stdout.trim());
}

async function mintCloneToken(
  env: Env,
  job: AgentJob,
  principal: AgentPrincipal,
  repo: string,
) {
  const stub = env.WORKSPACES.get(env.WORKSPACES.idFromName(job.workspaceId));
  const response = await stub.fetch(
    withTrustedContext(
      new Request("https://workspace.internal/git", {
        method: "POST",
        body: JSON.stringify({ repo }),
        headers: {
          "content-type": "application/json",
          "x-chief-internal-operation": "git-token",
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
    await response.body?.cancel();
    throw new Error(
      `Could not obtain a repository credential (${response.status}).`,
    );
  }
  const data = gitTokenResponseSchema.parse(await response.json());
  return data.token;
}

const gitTokenResponseSchema = z.object({ token: z.string().min(1) });
