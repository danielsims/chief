import { randomUUID } from "node:crypto";

import type { ProjectCapability } from "../src/project-types.js";
import { LocalStore } from "../src/local-store.js";

/**
 * Dev/QA helper: seeds project grants so an agent can actually exercise
 * checkout, commit, publish, and pull request flows without a permissions UI.
 *
 * Usage:
 *   pnpm --filter @chief/agent-runtime qa:seed-grants -- --workspace <orgId> --agent <agentId> [--project <projectId>] [--capability administer]
 *
 * When --project is omitted, the agent is granted on every project in the
 * workspace. Defaults to `administer`, which covers every capability.
 */

const tokens = process.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (let index = 0; index < tokens.length; index += 1) {
  const token = tokens[index];
  if (!token) continue;
  if (token === "--") continue;
  if (token.startsWith("--")) {
    const equals = token.indexOf("=");
    const key = equals >= 0 ? token.slice(2, equals) : token.slice(2);
    const value =
      equals >= 0 ? token.slice(equals + 1) : (tokens[index + 1] ?? "");
    flags.set(key, value);
    if (equals < 0) index += 1;
  } else {
    positional.push(token);
  }
}

const workspace = flags.get("workspace") ?? positional[0];
const agent = flags.get("agent") ?? positional[1];
const project = flags.get("project");
const capability = (flags.get("capability") ??
  "administer") as ProjectCapability;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!workspace) fail("Missing --workspace <organizationId>");
if (!agent) fail("Missing --agent <agentId>");
const validCapabilities = [
  "view",
  "checkout",
  "commit",
  "publish",
  "review",
  "administer",
];
if (!validCapabilities.includes(capability)) {
  fail(`Invalid --capability; choose one of ${validCapabilities.join(", ")}`);
}

const databasePath =
  process.env.CHIEF_DATABASE_PATH ?? `${process.env.HOME}/.chief/chief.sqlite`;
const store = new LocalStore(databasePath);
const persistence = store.projectStore();

const projects = project
  ? [await persistence.catalog.get(workspace, project)]
  : await persistence.catalog.list(workspace);

const targets = projects.filter((candidate) => candidate !== undefined);
if (targets.length === 0) {
  fail(
    project
      ? `Project ${project} was not found in workspace ${workspace}.`
      : `No projects found in workspace ${workspace}.`,
  );
}

const now = Date.now();
for (const target of targets) {
  await persistence.grants.saveGrant({
    id: randomUUID(),
    organizationId: workspace,
    projectId: target.id,
    principalType: "agent",
    principalId: agent,
    capability,
    createdAt: now,
    updatedAt: now,
  });
  console.log(
    `granted ${capability} for agent "${agent}" on project "${target.name}" (${target.id})`,
  );
}

console.log(
  `Done. Seeded ${targets.length} grant(s) in ${databasePath}. Restart the chat so the agent picks up the change.`,
);
