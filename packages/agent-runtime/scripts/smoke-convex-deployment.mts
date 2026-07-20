import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentEvent } from "../src/types.js";
import { materializeConvexWorkspace } from "../src/convex-workspace.js";
import { ConvexDeploymentProvider } from "../src/deployments/convex.js";
import { RemoteDriver } from "../src/drivers/remote.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(packageRoot, "templates", "convex");
const runtimeModules = join(packageRoot, "node_modules");
const root = join(tmpdir(), "chief-convex-smoke");
const projectName = process.env.CHIEF_SMOKE_PROJECT ?? "chief-agent-smoke";
const gatewayKey = process.env.AI_GATEWAY_API_KEY?.trim();
if (!gatewayKey) throw new Error("AI_GATEWAY_API_KEY is required.");

const preserved = [".env.local", ".chief-convex.json"].flatMap((name) => {
  const path = join(root, name);
  return existsSync(path) ? [{ name, value: readFileSync(path, "utf8") }] : [];
});
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true, mode: 0o700 });
cpSync(template, root, { recursive: true });
symlinkSync(runtimeModules, join(root, "node_modules"), "junction");
for (const { name, value } of preserved) {
  writeFileSync(join(root, name), value, { mode: 0o600 });
}
materializeConvexWorkspace(root, {
  context: "This is an isolated Chief deployment smoke test.",
});

const routePassword = randomBytes(32).toString("base64url");
const provider = new ConvexDeploymentProvider();
const deployment = await provider.deploy(
  {
    workspaceId: "convex-smoke",
    projectName,
    workspaceRoot: root,
    runtimeModules,
    routePassword,
    model: process.env.CHIEF_DEPLOYMENT_MODEL ?? "xai/grok-4.3",
    environment: {
      AI_GATEWAY_API_KEY: gatewayKey,
      CHIEF_CONTROL_PLANE_API_BASE_URL: "https://chief.invalid",
      CHIEF_CONTROL_PLANE_TOKEN: randomBytes(32).toString("base64url"),
    },
  },
  {
    phase: (phase, detail) => console.log(`[${phase}] ${detail}`),
    log: (line) => console.log(line),
    process: () => undefined,
    canceled: () => false,
  },
);

const driver = new RemoteDriver();
const events: AgentEvent[] = [];
driver.on("event", (event: AgentEvent) => events.push(event));
try {
  await driver.start({
    cwd: root,
    instructions: "You are running a deployment smoke test.",
    access: "guarded",
    env: {
      CHIEF_REMOTE_AGENT_TARGET: "convex",
      CHIEF_REMOTE_AGENT_URL: deployment.url,
      CHIEF_EVE_ROUTE_PASSWORD: routePassword,
    },
  });
  const completed = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Convex model turn timed out.")),
      90_000,
    );
    driver.on("event", (event: AgentEvent) => {
      if (event.type !== "result") return;
      clearTimeout(timeout);
      if (event.ok) resolve();
      else reject(new Error(event.error ?? "Convex model turn failed."));
    });
  });
  await driver.sendPrompt(
    "Reply with exactly CONVEX_OK. Do not call tools or add other text.",
  );
  await completed;
} finally {
  await driver.stop();
}

const answer = events
  .flatMap((event) =>
    event.type === "message"
      ? event.content.flatMap((part) =>
          part.type === "text" ? [part.text] : [],
        )
      : [],
  )
  .join("")
  .trim();
if (answer !== "CONVEX_OK") {
  throw new Error(`Unexpected Convex response: ${JSON.stringify(answer)}`);
}
console.log(`Convex deployment smoke passed at ${deployment.url}`);
