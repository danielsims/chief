export type PlaybookCategory =
  "Find customers" | "Content" | "Search" | "Conversion" | "Research";

export interface IntegrationDependency {
  domain: string;
  label: string;
  access: "connected" | "public";
  note?: string;
}

export interface Playbook {
  id: string;
  title: string;
  summary: string;
  task: string;
  agentId: string;
  categories: PlaybookCategory[];
  integrations: IntegrationDependency[];
  goal: string;
  inputs: string[];
  workflow: string[];
  deliverables: string[];
  accessNotes: string[];
  guardrails: string[];
}
