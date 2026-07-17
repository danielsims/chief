import type { AgentManifest } from "../manifest.js";

export const setup = {
  id: "setup",
  name: "Setup",
  role: "Integration Setup",
  description:
    "Connects marketing integrations by running the setup itself: CLI tools, local credentials and verification.",
} satisfies AgentManifest;
