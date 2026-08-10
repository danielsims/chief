import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  materializeEveWorkspace,
  readEveWorkspaceInput,
} from "../../../packages/agent-runtime/src/eve-workspace.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = materializeEveWorkspace(root, readEveWorkspaceInput(root));

console.log(
  `generated: ${result.agent.name}, ${result.playbookCount} skill(s), ${result.automationCount} cloud schedule(s)`,
);
