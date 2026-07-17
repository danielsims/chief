import { useEffect, useMemo, useRef, useState } from "react";

import type { AgentDefinition } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import { cn } from "@chief/ui/lib/utils";

import type { AuthOrganization } from "../../lib/auth/better-auth-client";
import { useAgentDeployments } from "../../lib/agent-deployments";
import { useAuth } from "../../lib/auth/auth-context";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
  updateAuthOrganization,
} from "../../lib/auth/better-auth-client";
import { playbookInstructions, PLAYBOOKS } from "../../lib/playbooks";
import {
  useWorkspaceData,
  useWorkspaceEnvironmentVariables,
} from "../../lib/runtime";

interface PersistedDeployment {
  url: string;
  target: "vercel";
  deployedAt?: number;
}

function persistedDeployment(
  org: AuthOrganization | null,
  agentId: string,
): PersistedDeployment | null {
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

function projectSlug(agentId: string, workspaceId: string | null) {
  const suffix = workspaceId?.replace(/[^a-z0-9]/gi, "").slice(-8) ?? "local";
  return `chief-${agentId}-${suffix}`.toLowerCase();
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
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const environment = useWorkspaceEnvironmentVariables();
  const deploymentState = useAgentDeployments(cloudOrganizationId);
  const [org, setOrg] = useState<AuthOrganization | null>(null);
  const [token, setToken] = useState("");
  const [teamId, setTeamId] = useState("");
  const [projectName, setProjectName] = useState(() =>
    projectSlug(agent.id, cloudOrganizationId),
  );
  const persistedUrl = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listAuthOrganizations().then((organizations) => {
      if (cancelled) return;
      setOrg(
        organizations.find((item) => item.id === cloudOrganizationId) ??
          organizations[0] ??
          null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [cloudOrganizationId]);

  const playbooks = useMemo(
    () =>
      PLAYBOOKS.filter((playbook) => playbook.agentId === agent.id).map(
        (playbook) => ({
          id: playbook.id,
          title: playbook.title,
          summary: playbook.summary,
          instructions: playbookInstructions(playbook),
        }),
      ),
    [agent.id],
  );
  const schedules = workspaceData.recurringWork.filter(
    (work) => work.agentId === agent.id && work.placement === "cloud",
  );
  const current = deploymentState.deployments.find(
    (deployment) => deployment.agentId === agent.id,
  );
  const saved = persistedDeployment(org, agent.id);
  const hasVercelToken = Boolean(
    environment.variables?.some((variable) => variable.key === "VERCEL_TOKEN"),
  );
  const running = current?.status === "running";

  useEffect(() => {
    if (!org || !current?.url || current.status !== "ready") return;
    if (persistedUrl.current === current.url) return;
    persistedUrl.current = current.url;
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
          [agent.id]: {
            url: current.url,
            target: "vercel",
            deployedAt: current.updatedAt,
          },
        },
      },
    };
    void updateAuthOrganization(org.id, { metadata: nextMetadata }).then(() =>
      setOrg({ ...org, metadata: nextMetadata }),
    );
  }, [agent.id, current, org]);

  return (
    <div className="bg-card flex min-h-[620px] flex-col">
      <header className="flex items-start justify-between gap-5 border-b p-6">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground mb-4 text-xs"
          >
            Back to {agent.name}
          </button>
          <h3 className="font-pixel text-3xl">Deploy {agent.name}</h3>
          <p className="text-muted-foreground mt-2 text-sm">
            Package this filesystem agent and run it on Vercel with Eve.
          </p>
        </div>
        {current?.url || saved?.url ? (
          <a
            href={current?.url ?? saved?.url}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground max-w-72 truncate text-xs"
          >
            {current?.url ?? saved?.url}
          </a>
        ) : null}
      </header>

      <div className="grid flex-1 gap-7 p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="space-y-6">
          <section className="space-y-4 border p-4">
            <div>
              <p className="text-sm font-medium">Vercel project</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Deployment starts only when you press Deploy.
              </p>
            </div>
            <label className="block space-y-2 text-xs">
              <span>Project name</span>
              <Input
                value={projectName}
                disabled={running}
                onChange={(event) =>
                  setProjectName(
                    event.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9._-]/g, "-"),
                  )
                }
              />
            </label>
            <label className="block space-y-2 text-xs">
              <span>Team ID</span>
              <Input
                value={teamId}
                disabled={running}
                onChange={(event) => setTeamId(event.target.value)}
                placeholder="Optional for a personal account"
              />
            </label>
          </section>

          {!hasVercelToken ? (
            <section className="space-y-3 border p-4">
              <div>
                <p className="text-sm font-medium">Connect Vercel</p>
                <p className="text-muted-foreground mt-1 text-xs leading-5">
                  Chief stores this token in the local workspace vault. Agents
                  never receive it.
                </p>
              </div>
              <Input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Vercel access token"
              />
              <Button
                variant="outline"
                disabled={!token.trim() || !environment.connected}
                onClick={() => {
                  environment.save("VERCEL_TOKEN", token.trim());
                  setToken("");
                }}
              >
                Save token
              </Button>
            </section>
          ) : null}

          {current ? (
            <section className="border">
              <div className="flex items-center justify-between gap-4 border-b p-4">
                <div>
                  <p className="text-sm font-medium capitalize">
                    {current.phase ?? current.status.replace("_", " ")}
                  </p>
                  {current.detail ? (
                    <p className="text-muted-foreground mt-1 text-xs">
                      {current.detail}
                    </p>
                  ) : null}
                </div>
                <span
                  className={cn(
                    "size-2",
                    current.status === "ready"
                      ? "bg-emerald-500"
                      : current.status === "failed"
                        ? "bg-red-500"
                        : current.status === "running"
                          ? "animate-pulse bg-blue-500"
                          : "bg-amber-400",
                  )}
                />
              </div>
              <div className="max-h-52 overflow-y-auto p-4 font-mono text-[11px] leading-5">
                {current.logs.length > 0
                  ? current.logs.map((line, index) => (
                      <p key={`${index}-${line}`}>{line}</p>
                    ))
                  : "Waiting for deployment output…"}
              </div>
            </section>
          ) : null}

          <footer className="flex items-center justify-between gap-4 border-t pt-5">
            <p className="text-muted-foreground text-xs">
              {hasVercelToken
                ? `${playbooks.length} playbooks and ${schedules.length} cloud schedules will be included.`
                : "Connect Vercel before deploying."}
            </p>
            {current?.status === "running" ? (
              <Button
                variant="outline"
                onClick={() => deploymentState.cancel(current.id)}
              >
                Cancel
              </Button>
            ) : (
              <Button
                disabled={
                  !deploymentState.ready ||
                  !hasVercelToken ||
                  !projectName.trim() ||
                  !org
                }
                onClick={() =>
                  deploymentState.start({
                    agentId: agent.id,
                    projectName: projectName.trim(),
                    teamId: teamId.trim() || undefined,
                    playbooks,
                  })
                }
              >
                {saved || current?.status === "ready" ? "Redeploy" : "Deploy"}
              </Button>
            )}
          </footer>
        </main>

        <aside className="border p-4">
          <p className="text-sm font-medium">Deployment package</p>
          <div className="mt-3 border-t pt-2">
            <FileRow name="agent/" />
            <FileRow depth={1} name="instructions.md" />
            <FileRow depth={1} name="agent.ts" />
            <FileRow depth={1} name={`skills/ (${playbooks.length})`} />
            <FileRow depth={1} name={`schedules/ (${schedules.length})`} />
            <FileRow depth={1} name="connections/executor.ts" />
          </div>
        </aside>
      </div>
    </div>
  );
}
