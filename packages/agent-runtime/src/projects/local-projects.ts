import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";

import {
  relayProjectCreateSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { resolveProjectProvider } from "./providers.js";
import {
  assertRemoteUrl,
  cleanRemoteUrl,
  git,
  optionalGit,
  repositoryDefaultBranch,
  repositoryRoot,
  workspaceSegment,
} from "./repository-git.js";

const connectionSchema = z.object({
  connectionId: z.string().uuid(),
  workspaceId: z.string().min(1),
  repositoryPath: z.string().min(1),
  project: z
    .unknown()
    .transform((value) => relayProjectCreateSchema.parse(value)),
  projectId: z.string().min(1).optional(),
});

const prepareSchema = z.discriminatedUnion("source", [
  z.object({
    workspaceId: z
      .string()
      .transform((value) => workspaceIdSchema.parse(value)),
    source: z.literal("attach"),
    path: z.string().trim().min(1),
  }),
  z.object({
    workspaceId: z
      .string()
      .transform((value) => workspaceIdSchema.parse(value)),
    source: z.literal("clone"),
    remoteUrl: z.string().trim().min(1),
  }),
]);

function registryRoot(workspaceId: string, root = join(homedir(), ".chief")) {
  return join(root, "local-projects", workspaceSegment(workspaceId));
}

async function saveConnection(
  connection: z.infer<typeof connectionSchema>,
  root?: string,
) {
  const directory = registryRoot(connection.workspaceId, root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${connection.connectionId}.json`);
  const pending = `${path}.${randomUUID()}.tmp`;
  await writeFile(pending, JSON.stringify(connection), { mode: 0o600 });
  await rename(pending, path);
}

type LocalProjectPreparation = z.input<typeof prepareSchema>;

export function parseLocalProjectPreparation(input: unknown) {
  return prepareSchema.parse(input);
}

export async function prepareLocalProject(
  parsed: LocalProjectPreparation,
  root?: string,
) {
  const connectionId = randomUUID();
  let path: string;
  if (parsed.source === "attach") {
    path = await repositoryRoot(parsed.path);
  } else {
    const remote = assertRemoteUrl(parsed.remoteUrl);
    const destination = join(
      registryRoot(parsed.workspaceId, root),
      "repositories",
      connectionId,
    );
    await mkdir(join(destination, ".."), { recursive: true, mode: 0o700 });
    try {
      await git(["clone", "--", remote, destination], undefined, 120_000);
    } catch {
      throw new Error(
        "Could not clone this repository. For private GitHub repositories, run gh auth login and gh auth setup-git on this Mac, or use an SSH URL with an authorized SSH key. You can also attach an existing checkout.",
      );
    }
    path = await repositoryRoot(destination);
  }
  const rawRemote = cleanRemoteUrl(
    await optionalGit(["remote", "get-url", "origin"], path),
  );
  // Normalize scp SSH syntax into a URL accepted by the relay contract.
  const remote = rawRemote?.replace(
    /^([^@/]+)@([^:/]+):(.+)$/u,
    "ssh://$1@$2/$3",
  );
  if (remote) assertRemoteUrl(remote);
  const provider = resolveProjectProvider(remote);
  const project = relayProjectCreateSchema.parse({
    name: basename(path),
    repositoryKind: parsed.source === "attach" ? "attached" : "cloned",
    providerId: provider.id,
    canonicalRemoteUrl: provider.canonicalRemoteUrl,
    repositoryWebUrl: provider.repositoryWebUrl,
    defaultBranch: await repositoryDefaultBranch(path),
  });
  if (parsed.source === "clone" && remote)
    project.name =
      new URL(remote).pathname
        .split("/")
        .at(-1)
        ?.replace(/\.git$/iu, "") ?? project.name;
  await saveConnection(
    {
      connectionId,
      workspaceId: parsed.workspaceId,
      repositoryPath: path,
      project,
    },
    root,
  );
  return { connectionId, project };
}

const bindingInputSchema = z.object({
  workspaceId: z.string().transform((value) => workspaceIdSchema.parse(value)),
  connectionId: z.string().uuid(),
  projectId: z.string().trim().min(1).max(128),
});
type LocalProjectBindingInput = z.input<typeof bindingInputSchema>;

export function parseLocalProjectBinding(input: unknown) {
  return bindingInputSchema.parse(input);
}

export async function bindLocalProject(
  parsed: LocalProjectBindingInput,
  root?: string,
) {
  const path = join(
    registryRoot(parsed.workspaceId, root),
    `${parsed.connectionId}.json`,
  );
  const connection = connectionSchema.parse(
    JSON.parse(await readFile(path, "utf8")),
  );
  if (connection.workspaceId !== parsed.workspaceId)
    throw new Error("Project belongs to another workspace.");
  await saveConnection({ ...connection, projectId: parsed.projectId }, root);
  for (const previous of await listLocalProjectBindings(
    parsed.workspaceId,
    root,
  )) {
    if (
      previous.projectId === parsed.projectId &&
      previous.connectionId !== parsed.connectionId
    ) {
      await unlink(
        join(
          registryRoot(parsed.workspaceId, root),
          `${previous.connectionId}.json`,
        ),
      );
    }
  }
  return { connected: true };
}

export async function listLocalProjectBindings(
  workspaceId: string,
  root?: string,
) {
  const directory = registryRoot(workspaceId, root);
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
  const connections = await Promise.all(
    entries
      .filter((name) => name.endsWith(".json"))
      .map(async (name) =>
        connectionSchema.parse(
          JSON.parse(await readFile(join(directory, name), "utf8")),
        ),
      ),
  );
  return connections.flatMap((connection) =>
    connection.workspaceId === workspaceId && connection.projectId
      ? [{ ...connection, projectId: connection.projectId }]
      : [],
  );
}

export async function prepareLocalProjectCheckout(
  input: { workspaceId: string; projectId: string; agentId: string },
  root?: string,
) {
  const binding = (
    await listLocalProjectBindings(input.workspaceId, root)
  ).find((entry) => entry.projectId === input.projectId);
  if (!binding)
    throw new Error(
      "Connect this project on this Mac before assigning it to a local agent.",
    );
  const key = createHash("sha256")
    .update(`${input.projectId}\0${input.agentId}`)
    .digest("hex")
    .slice(0, 24);
  const directory = join(
    registryRoot(input.workspaceId, root),
    "worktrees",
    key,
  );
  const existing = await optionalGit(
    ["rev-parse", "--show-toplevel"],
    directory,
  );
  if (existing)
    return {
      directory: await repositoryRoot(directory),
      projectId: input.projectId,
      name: binding.project.name,
    };
  await mkdir(join(directory, ".."), { recursive: true, mode: 0o700 });
  await git(
    ["worktree", "add", "-b", `chief/${key}`, "--", directory, "HEAD"],
    binding.repositoryPath,
  );
  return {
    directory: await repositoryRoot(directory),
    projectId: input.projectId,
    name: binding.project.name,
  };
}
