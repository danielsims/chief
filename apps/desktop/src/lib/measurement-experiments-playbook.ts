import type { IntegrationDependency, Playbook } from "./playbook-types";

export function createMeasurementExperimentsPlaybook(input: {
  integrations: IntegrationDependency[];
  sharedGuardrails: string[];
}): Playbook {
  return {
    id: "measurement-experiments",
    title: "Measurement & experiments",
    summary: "Instrument the customer journey and close the learning loop.",
    task: "Audit our growth measurement, define the smallest useful event taxonomy, and prepare any approved implementation as a narrow reviewable pull request. Verify the resulting events before recommending experiments.",
    agentId: "setup",
    categories: ["Conversion", "Research"],
    integrations: input.integrations,
    goal: "Connect product changes, acquisition signals, and conversion outcomes without turning Chief into a general-purpose engineering team.",
    inputs: [
      "The primary customer journey and business outcome to measure.",
      "Read access to the relevant repository, analytics sources, and deployment context.",
      "An explicit approval before Chief creates a branch, pull request, deployment, or external mutation.",
    ],
    workflow: [
      "Inspect the existing analytics, product-event, repository, and deployment setup before proposing new tooling.",
      "Define a lean event taxonomy covering acquisition, activation, conversion, and the experiment decision metric.",
      "Write a Growth Readiness Plan that separates connection work, code changes, verification, and optional follow-up experiments.",
      "When a code change is approved, create one narrowly scoped branch and draft pull request with the smallest viable diff and no unrelated cleanup.",
      "Run the repository's existing checks and report failures honestly; never weaken tests, lint rules, or types to make the change pass.",
      "Verify live events or preview behavior before marking measurement ready, then record the experiment hypothesis, audience, metric, threshold, and decision rule.",
    ],
    deliverables: [
      "A Growth Readiness Plan with current coverage, gaps, and the smallest useful next step.",
      "A concise event taxonomy with exact names, triggers, properties, and success criteria.",
      "An optional approved draft pull request containing only the measurement change.",
      "A verification record and an experiment backlog tied to observable outcomes.",
    ],
    accessNotes: [
      "GitHub supplies repository, release, issue, branch, and pull-request context; Vercel can supply preview and deployment evidence.",
      "Google Analytics covers acquisition and site behavior; PostHog or an equivalent product analytics source can cover product-event progression.",
      "The playbook remains useful as a read-only audit when repository write access is unavailable.",
    ],
    guardrails: [
      ...input.sharedGuardrails,
      "Never push to a default or protected branch, merge a pull request, deploy to production, change secrets, or widen repository access without explicit approval for that action.",
      "Do not build unrelated product features or perform broad refactors under the guise of measurement setup.",
      "Never expose repository credentials, deployment tokens, analytics secrets, or customer data in chat, commits, logs, or pull-request text.",
    ],
  };
}
