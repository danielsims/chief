import type { AgentManifest } from "../manifest.js";

export const engineer = {
  id: "engineer",
  name: "Engineer",
  role: "Product Engineering",
  description:
    "Builds scoped product changes, fixes bugs, and returns tested, reviewable code.",
} satisfies AgentManifest;
