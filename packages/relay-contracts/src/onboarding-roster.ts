export const onboardingAgents = [
  {
    id: "researcher",
    name: "Researcher",
    role: "Research",
    description: "Find answers and compare options.",
    color: "#7dc7fa",
    purpose: "personal",
  },
  {
    id: "planner",
    name: "Planner",
    role: "Planning",
    description: "Turn priorities into practical plans.",
    color: "#61dbe8",
    purpose: "personal",
  },
  {
    id: "writer",
    name: "Writer",
    role: "Writing",
    description: "Help with drafts and everyday writing.",
    color: "#fcc24d",
    purpose: "personal",
  },
  {
    id: "brand",
    name: "Marketer",
    role: "Marketing",
    description: "Help with your brand and content.",
    color: "#7adb9e",
    purpose: "company",
  },
  {
    id: "content",
    name: "Content Writer",
    role: "Content & Social",
    description: "Draft content and social posts.",
    color: "#fcc24d",
    purpose: "company",
  },
  {
    id: "analyst",
    name: "Analyst",
    role: "Analytics & Reporting",
    description: "Make sense of metrics and performance.",
    color: "#61dbe8",
    purpose: "company",
  },
  {
    id: "prospector",
    name: "Prospector",
    role: "Research and Outreach",
    description: "Research potential customers.",
    color: "#7dc7fa",
    purpose: "company",
  },
  {
    id: "ads",
    name: "Ads Manager",
    role: "Paid Acquisition",
    description: "Review campaigns and creative.",
    color: "#fa8ca8",
    purpose: "company",
  },
  {
    id: "engineer",
    name: "Engineer",
    role: "Product Engineering",
    description: "Support product and technical work.",
    color: "#fa9c57",
    purpose: "company",
  },
  {
    id: "setup",
    name: "Setup",
    role: "Workspace Setup",
    description: "Help connect apps and services.",
    color: "#61d9a3",
    purpose: "company",
  },
] as const;

export type WorkspacePurpose = "personal" | "company";
export function suggestedAgentIds(purpose: WorkspacePurpose) {
  return onboardingAgents
    .filter((agent) => agent.purpose === purpose && agent.id !== "writer")
    .map((agent) => agent.id);
}
export function workspaceSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
