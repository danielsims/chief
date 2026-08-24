import type { Playbook } from "./playbook-types";
import { PLAYBOOKS } from "./playbook-catalog";

export function playbookInstructions(playbook: Playbook) {
  const section = (title: string, items: string[]) =>
    `## ${title}\n\n${items.map((item) => `- ${item}`).join("\n")}`;
  const services = playbook.integrations.map((item) => item.label);
  return [
    `# ${playbook.title}`,
    playbook.goal,
    section("Required inputs", playbook.inputs),
    section("Workflow", playbook.workflow),
    section("Deliverables", playbook.deliverables),
    section("Access and limitations", playbook.accessNotes),
    section("Guardrails", playbook.guardrails),
    `Owner: ${playbook.agentId}. Services: ${services.join(", ")}.`,
  ].join("\n\n");
}

export function playbookRunPrompt(playbook: Playbook) {
  return `Run the ${playbook.title} playbook for my brand.\n\n${playbookInstructions(playbook)}\n\nReturn the deliverables in this conversation. Do not publish or change external systems without my approval.`;
}

export function playbookSetupPrompt(playbook: Playbook) {
  const services = playbook.integrations
    .map(
      (integration) =>
        `- ${integration.label}: ${integration.access === "connected" ? "check and configure connection" : "verify an allowed read path"}${integration.note ? `; ${integration.note}` : ""}`,
    )
    .join("\n");
  return `Prepare the ${playbook.title} playbook for this workspace. Do not run the playbook yet.\n\nAudit these service requirements:\n${services}\n\nVerify the minimum useful read path for every service, reuse existing workspace credentials where safe, and configure only what this playbook actually needs. If the platform requires user consent, app review, or eligibility that cannot be completed automatically, explain the exact limitation and the smallest user action required. Never claim broad public coverage when access is limited to owned accounts or approved endpoints. Finish with a readiness summary: ready, usable with reduced coverage, or blocked.`;
}

export function getPlaybook(id: string | null | undefined) {
  return PLAYBOOKS.find((playbook) => playbook.id === id);
}
