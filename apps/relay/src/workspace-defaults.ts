import type { WorkspaceSnapshot } from "@chief/relay-contracts";

export const defaultWorkspaceAgents = [
  {
    id: "chief",
    name: "Chief",
    role: "Chief of staff",
    status: "working",
  },
  {
    id: "brand",
    name: "Marketer",
    role: "Marketing",
    status: "idle",
  },
  {
    id: "content",
    name: "Content",
    role: "Content and creative",
    status: "idle",
  },
  {
    id: "analyst",
    name: "Analyst",
    role: "Measurement and reporting",
    status: "idle",
  },
  {
    id: "ads",
    name: "Advertising",
    role: "Paid acquisition",
    status: "idle",
  },
  {
    id: "prospector",
    name: "Prospector",
    role: "Research and outreach",
    status: "idle",
  },
  {
    id: "engineer",
    name: "Engineer",
    role: "Product engineering",
    status: "idle",
  },
  {
    id: "setup",
    name: "Setup",
    role: "Connections and integrations",
    status: "idle",
  },
] as const satisfies WorkspaceSnapshot["agents"];

export function reconcileWorkspaceAgents(snapshot: WorkspaceSnapshot): {
  snapshot: WorkspaceSnapshot;
  changed: boolean;
} {
  const existing = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
  const missing = defaultWorkspaceAgents.filter(
    (agent) => !existing.has(agent.id),
  );
  const missionControlWasPrivate = snapshot.conversations.some(
    (conversation) =>
      conversation.id === "mission-control" && conversation.isPrivate,
  );
  if (missing.length === 0 && !missionControlWasPrivate) {
    return { snapshot, changed: false };
  }
  return {
    snapshot: {
      ...snapshot,
      conversations: snapshot.conversations.map((conversation) =>
        conversation.id === "mission-control"
          ? { ...conversation, isPrivate: false }
          : conversation,
      ),
      agents: [
        ...defaultWorkspaceAgents.map(
          (agent) => existing.get(agent.id) ?? agent,
        ),
        ...snapshot.agents.filter(
          (agent) =>
            !defaultWorkspaceAgents.some(
              (required) => required.id === agent.id,
            ),
        ),
      ],
    },
    changed: true,
  };
}
