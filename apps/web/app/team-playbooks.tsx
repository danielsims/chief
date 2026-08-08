"use client";

import { useState } from "react";

export interface LandingPlaybook {
  id: string;
  title: string;
  summary: string;
  agentId: string;
  integrations: { domain: string; label: string }[];
  goal: string;
  workflow: string[];
  deliverables: string[];
}

const agents = [
  {
    id: "cmo",
    name: "Chief",
    role: "Coordination and decisions",
  },
  { id: "engineer", name: "Engineer", role: "Code and product delivery" },
  { id: "ads", name: "Marketer", role: "Campaigns and growth execution" },
  { id: "analyst", name: "Analyst", role: "Analytics and reporting" },
  { id: "content", name: "Writer", role: "Writing and communication" },
  { id: "prospector", name: "Researcher", role: "Research and discovery" },
] as const;

type AgentId = (typeof agents)[number]["id"];

const whiteLogos = new Set([
  "x.com",
  "instagram.com",
  "openai.com",
  "news.ycombinator.com",
]);

function IntegrationStack({
  integrations,
}: {
  integrations: LandingPlaybook["integrations"];
}) {
  const visible = integrations.slice(0, 4);
  const remaining = integrations.length - visible.length;

  return (
    <span
      className="playbook-integrations"
      aria-label={`Uses ${integrations.map((item) => item.label).join(", ")}`}
    >
      {visible.map((integration) => (
        <span
          className="playbook-integration"
          title={integration.label}
          key={integration.domain}
        >
          <span>{integration.label.slice(0, 1)}</span>
          <img
            className={
              whiteLogos.has(integration.domain) ? "white-logo" : undefined
            }
            src={`https://integrations.sh/logo/${integration.domain}`}
            alt=""
            loading="lazy"
            onError={(event) => event.currentTarget.remove()}
          />
        </span>
      ))}
      {remaining > 0 ? (
        <span className="playbook-integration more">+{remaining}</span>
      ) : null}
    </span>
  );
}

export function TeamPlaybooks({ playbooks }: { playbooks: LandingPlaybook[] }) {
  const [agentId, setAgentId] = useState<AgentId>(agents[0].id);
  const visible = playbooks.filter((playbook) => playbook.agentId === agentId);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    playbooks.find((playbook) => playbook.agentId === agents[0].id)?.id ??
      playbooks[0]?.id,
  );
  const selected =
    visible.find((playbook) => playbook.id === selectedId) ??
    visible[0] ??
    playbooks[0];
  const owner = agents.find((agent) => agent.id === agentId);

  if (!selected) return null;

  const selectAgent = (nextAgentId: AgentId) => {
    setAgentId(nextAgentId);
    setSelectedId(
      playbooks.find((playbook) => playbook.agentId === nextAgentId)?.id,
    );
  };

  return (
    <section className="team" id="team">
      <div className="team-intro">
        <h2>A small team of specialists, working as one.</h2>
        <div
          className="agent-selector"
          role="tablist"
          aria-label="Specialist agents"
        >
          {agents.map((agent) => {
            return (
              <button
                className={agent.id === agentId ? "selected" : undefined}
                type="button"
                role="tab"
                aria-selected={agent.id === agentId}
                onClick={() => selectAgent(agent.id)}
                key={agent.id}
              >
                <span>
                  <strong>{agent.name}</strong>
                  <small>{agent.role}</small>
                </span>
              </button>
            );
          })}
        </div>
        <a className="button button-primary team-cta" href="/download">
          Deploy your team
        </a>
      </div>

      <div className="playbook-showcase">
        <header>
          <strong>{owner?.name}</strong>
          <span>{visible.length} playbooks</span>
        </header>
        <div className="showcase-list">
          {visible.map((playbook) => {
            const expanded = playbook.id === selected.id;
            return (
              <article
                className={expanded ? "expanded" : undefined}
                key={playbook.id}
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setSelectedId(playbook.id)}
                >
                  <span>
                    <strong>{playbook.title}</strong>
                    <small>{playbook.summary}</small>
                  </span>
                  <IntegrationStack integrations={playbook.integrations} />
                </button>
                {expanded ? (
                  <div className="showcase-detail">
                    <p>{playbook.goal}</p>
                    <ol>
                      {playbook.workflow.slice(0, 2).map((step, index) => (
                        <li key={step}>
                          <span>{index + 1}</span>
                          <p>{step}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
