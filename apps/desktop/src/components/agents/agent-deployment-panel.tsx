import { useEffect, useState } from "react";

import type { AgentDefinition } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import type { AuthOrganization } from "../../lib/auth/better-auth-client";
import type { DeployTarget } from "../../lib/deploy-workspace";
import type { SetupResult } from "../../lib/integration-setup";
import { useAgentConfig } from "../../lib/agent-config";
import { useAuth } from "../../lib/auth/auth-context";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
  updateAuthOrganization,
} from "../../lib/auth/better-auth-client";
import {
  AGENT_DEPLOY_PROVIDER,
  deployAgentTask,
} from "../../lib/deploy-workspace";
import { playbookInstructions, PLAYBOOKS } from "../../lib/playbooks";
import { useWorkspaceData } from "../../lib/runtime";
import { IntegrationSetupPanel } from "../chat/integration-setup-panel";

interface AgentDeployment {
  url: string;
  target: DeployTarget;
  deployedAt?: number;
}

function readAgentDeployment(
  org: AuthOrganization | null,
  agentId: string,
): AgentDeployment | null {
  if (!org) return null;
  const metadata = parseOrganizationMetadata(org);
  const onboarding =
    metadata.onboarding && typeof metadata.onboarding === "object"
      ? (metadata.onboarding as Record<string, unknown>)
      : {};
  const deployments =
    onboarding.agentDeployments &&
    typeof onboarding.agentDeployments === "object"
      ? (onboarding.agentDeployments as Record<string, unknown>)
      : {};
  const raw = deployments[agentId];
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.url !== "string" || !value.url) return null;
  return {
    url: value.url,
    target: "vercel",
    deployedAt:
      typeof value.deployedAt === "number" ? value.deployedAt : undefined,
  };
}

function useDeploymentHealth(url: string | null) {
  const [health, setHealth] = useState<"checking" | "live" | "unreachable">(
    "checking",
  );
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setHealth("checking");
    fetch(url, { method: "GET", mode: "no-cors" })
      .then(() => !cancelled && setHealth("live"))
      .catch(() => !cancelled && setHealth("unreachable"));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return health;
}

function FileRow({ depth = 0, name }: { depth?: number; name: string }) {
  return (
    <div
      className="flex h-7 items-center gap-2 text-xs"
      style={{ paddingLeft: depth * 16 }}
    >
      <span className="bg-muted-foreground/60 size-1 shrink-0" />
      <span className="text-muted-foreground truncate font-mono">{name}</span>
    </div>
  );
}

export function AgentDeploymentPanel({
  agent,
  onBack,
}: {
  agent: AgentDefinition;
  onBack: () => void;
}) {
  const { cloudOrganizationId } = useAuth();
  const agentConfig = useAgentConfig();
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const [org, setOrg] = useState<AuthOrganization | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listAuthOrganizations().then((organizations) => {
      if (cancelled) return;
      setOrg(
        organizations.find(
          (candidate) => candidate.id === cloudOrganizationId,
        ) ??
          organizations[0] ??
          null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [cloudOrganizationId]);

  const deployment = readAgentDeployment(org, agent.id);
  const health = useDeploymentHealth(deployment?.url ?? null);
  const driver =
    agentConfig.forAgent("setup").driver ??
    agentConfig.forAgent(agent.id).driver;
  const playbooks = PLAYBOOKS.filter(
    (playbook) => playbook.agentId === agent.id,
  );
  const schedules = workspaceData.recurringWork.filter(
    (work) => work.agentId === agent.id && work.placement === "cloud",
  );

  const persistResult = async (result: SetupResult) => {
    if (result.provider !== AGENT_DEPLOY_PROVIDER) return;
    setDeploying(false);
    const url = typeof result.url === "string" ? result.url : null;
    if (!org || !url || result.status !== "connected") {
      if (result.status !== "connected") setError("Deployment did not finish.");
      return;
    }
    try {
      const metadata = parseOrganizationMetadata(org);
      const onboarding =
        metadata.onboarding && typeof metadata.onboarding === "object"
          ? (metadata.onboarding as Record<string, unknown>)
          : {};
      const deployments =
        onboarding.agentDeployments &&
        typeof onboarding.agentDeployments === "object"
          ? (onboarding.agentDeployments as Record<string, unknown>)
          : {};
      const nextMetadata = {
        ...metadata,
        onboarding: {
          ...onboarding,
          agentDeployments: {
            ...deployments,
            [agent.id]: { url, target: "vercel", deployedAt: Date.now() },
          },
        },
      };
      await updateAuthOrganization(org.id, { metadata: nextMetadata });
      setOrg({ ...org, metadata: nextMetadata });
      setError(null);
    } catch (persistError) {
      setError(
        persistError instanceof Error
          ? persistError.message
          : String(persistError),
      );
    }
  };

  return (
    <div className="bg-card flex min-h-[620px] flex-col">
      <div className="flex flex-wrap items-start justify-between gap-5 border-b p-6">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground mb-4 text-xs transition-colors"
          >
            Back to {agent.name}
          </button>
          <h3 className="font-serif text-3xl">Deploy {agent.name}</h3>
          <p className="text-muted-foreground mt-2 text-sm">
            Deploy this agent as its own Eve project.
          </p>
        </div>
        {deployment ? (
          <div className="text-right">
            <div className="flex items-center justify-end gap-2 text-xs">
              <span
                className={cn(
                  "size-1.5",
                  health === "live"
                    ? "bg-emerald-500"
                    : health === "unreachable"
                      ? "bg-amber-400"
                      : "bg-muted-foreground/50",
                )}
              />
              {health === "live"
                ? "Live"
                : health === "unreachable"
                  ? "Not responding"
                  : "Checking"}
            </div>
            <a
              href={deployment.url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground mt-1 block max-w-72 truncate text-xs"
            >
              {deployment.url}
            </a>
          </div>
        ) : null}
      </div>

      <div className="grid flex-1 gap-7 p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-7">
          <section className="border p-4">
            <p className="text-sm font-medium">Vercel</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Managed Eve runtime.
            </p>
          </section>

          {deploying && driver ? (
            <IntegrationSetupPanel
              domain={AGENT_DEPLOY_PROVIDER}
              prompt={deployAgentTask(
                agent,
                playbooks.map((playbook) => ({
                  id: playbook.id,
                  title: playbook.title,
                  summary: playbook.summary,
                  instructions: playbookInstructions(playbook),
                })),
              )}
              driver={driver}
              onResult={(result) => void persistResult(result)}
            />
          ) : null}

          {error ? <p className="text-destructive text-xs">{error}</p> : null}

          <div className="flex items-center justify-between gap-4 border-t pt-5">
            <p className="text-muted-foreground text-xs">
              {driver
                ? "Setup handles sign-in and verifies the live agent."
                : "Choose an agent app before deploying."}
            </p>
            <Button
              disabled={deploying || !driver || !org}
              onClick={() => {
                setError(null);
                setDeploying(true);
              }}
            >
              {deployment ? "Redeploy" : "Deploy"}
            </Button>
          </div>
        </div>

        <aside className="border p-4">
          <p className="text-sm font-medium">Files</p>
          <div className="mt-3 border-t pt-2">
            <FileRow name="workspace/" />
            <FileRow depth={1} name="agent/" />
            <FileRow depth={2} name="instructions.md" />
            <FileRow depth={2} name="agent.ts" />
            {playbooks.length > 0 ? (
              <>
                <FileRow depth={2} name="skills/" />
                {playbooks.map((playbook) => (
                  <FileRow
                    key={playbook.id}
                    depth={3}
                    name={`${playbook.id}.md`}
                  />
                ))}
              </>
            ) : null}
            <FileRow depth={2} name={`schedules/ (${schedules.length})`} />
            <FileRow depth={2} name="connections/executor.ts" />
            <FileRow depth={1} name="workspace-input/context.md" />
          </div>
        </aside>
      </div>
    </div>
  );
}
