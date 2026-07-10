import type { AgentDefinition } from "../../types.js";
import { instructions } from "./instructions.js";

export const setup: AgentDefinition = {
  id: "setup",
  name: "Setup",
  role: "Integration Setup",
  description:
    "Connects marketing integrations by running the setup itself: CLI tools, local credentials and verification.",
  instructions,
};
