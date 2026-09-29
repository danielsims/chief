import { WORKSPACE_AGENT_IDENTITIES } from "../lib/workspace-channels";

export const DASHBOARD_MENTION_CANDIDATES = Object.entries(
  WORKSPACE_AGENT_IDENTITIES,
)
  .filter(([id]) => id !== "setup")
  .map(([id, identity]) => ({
    id,
    ...identity,
    member: id === "chief",
  }));
