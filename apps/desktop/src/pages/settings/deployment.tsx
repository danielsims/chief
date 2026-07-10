import { useEffect, useState } from "react";
import { Link } from "react-router";
import { defaultAgents } from "@marketer/agent-runtime/agents";
import { Button } from "@marketer/ui/components/button";
import { cn } from "@marketer/ui/lib/utils";

import { IntegrationSetupPanel } from "../../components/chat/integration-setup-panel";
import { useAgentConfig } from "../../lib/agent-config";
import { useAuth } from "../../lib/auth/auth-context";
import {
  type AuthOrganization,
  listAuthOrganizations,
  parseOrganizationMetadata,
  updateAuthOrganization,
} from "../../lib/auth/better-auth-client";
import {
  DEPLOY_PROVIDER,
  DEPLOY_TARGETS,
  deployWorkspaceTask,
  type DeployTarget,
} from "../../lib/deploy-workspace";
import type { SetupResult } from "../../lib/integration-setup";
import { useWorkspaceData } from "../../lib/runtime";

interface DeploymentState {
  url: string;
  target: DeployTarget;
  deployedAt?: number;
}

function readDeployment(org: AuthOrganization | null): DeploymentState | null {
  if (!org) return null;
  const metadata = parseOrganizationMetadata(org);
  const onboarding =
    metadata.onboarding && typeof metadata.onboarding === "object"
      ? (metadata.onboarding as Record<string, unknown>)
      : {};
  const url =
    typeof onboarding.cloudDeploymentUrl === "string" &&
    onboarding.cloudDeploymentUrl
      ? onboarding.cloudDeploymentUrl
      : null;
  if (!url) return null;
  const target = onboarding.cloudDeploymentTarget;
  const deployedAt = onboarding.cloudDeployedAt;
  return {
    url,
    target:
      target === "cloudflare" || target === "railway" ? target : "vercel",
    deployedAt: typeof deployedAt === "number" ? deployedAt : undefined,
  };
}

/** Quiet reachability check: any HTTP answer means the deployment is up. */
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

const team = defaultAgents.filter((agent) => agent.id !== "setup");

export function DeploymentSettings() {
  const { cloudOrganizationId } = useAuth();
  const agentConfig = useAgentConfig();
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const [org, setOrg] = useState<AuthOrganization | null>(null);
  const [target, setTarget] = useState<DeployTarget>("vercel");
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listAuthOrganizations().then((orgs) => {
      if (cancelled) return;
      setOrg(
        orgs.find((candidate) => candidate.id === cloudOrganizationId) ??
          orgs[0] ??
          null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [cloudOrganizationId]);

  const deployment = readDeployment(org);
  const health = useDeploymentHealth(deployment?.url ?? null);
  const driver = agentConfig.forAgent("setup").driver;
  const cloudSchedules = workspaceData.recurringWork.filter(
    (work) => work.placement === "cloud",
  );

  useEffect(() => {
    if (deployment) setTarget(deployment.target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployment?.target]);

  const persistResult = async (result: SetupResult) => {
    if (result.provider !== DEPLOY_PROVIDER) return;
    setDeploying(false);
    const url = typeof result.url === "string" ? result.url : null;
    if (!org || !url || result.status !== "connected") {
      if (result.status !== "connected") {
        setError("Deployment did not finish. The log above has the details.");
      }
      return;
    }
    setError(null);
    try {
      const current = parseOrganizationMetadata(org);
      const onboarding =
        current.onboarding && typeof current.onboarding === "object"
          ? (current.onboarding as Record<string, unknown>)
          : {};
      const nextMetadata = {
        ...current,
        onboarding: {
          ...onboarding,
          cloudDeploymentUrl: url,
          cloudDeploymentTarget:
            typeof result.target === "string" ? result.target : target,
          cloudDeployedAt: Date.now(),
        },
      };
      await updateAuthOrganization(org.id, { metadata: nextMetadata });
      setOrg({ ...org, metadata: nextMetadata });
    } catch (persistError) {
      setError(
        persistError instanceof Error
          ? persistError.message
          : String(persistError),
      );
    }
  };

  return (
    <div className="space-y-8">
      {deployment ? (
        <section className="border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-4 p-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "size-1.5 shrink-0",
                    health === "live"
                      ? "bg-emerald-500"
                      : health === "checking"
                        ? "bg-muted-foreground/40"
                        : "bg-amber-400",
                  )}
                />
                <h2 className="font-serif text-2xl leading-none">
                  Your team is live.
                </h2>
              </div>
              <a
                href={deployment.url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block truncate text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {deployment.url}
              </a>
              <p className="mt-1 text-xs text-muted-foreground">
                {DEPLOY_TARGETS.find((item) => item.value === deployment.target)
                  ?.label ?? deployment.target}
                {deployment.deployedAt
                  ? ` · deployed ${new Date(deployment.deployedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                  : ""}
                {health === "unreachable" ? " · not responding" : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={deployment.url} target="_blank" rel="noreferrer">
                  Open
                </a>
              </Button>
              {driver ? (
                <Button
                  size="sm"
                  disabled={deploying}
                  onClick={() => {
                    setError(null);
                    setDeploying(true);
                  }}
                >
                  Redeploy
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <section>
          <h2 className="font-serif text-2xl">Deploy your team</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Your agents, brand context and approved schedules ship as one
            artifact to a host you own. Schedules keep running with your
            laptop closed, and Slack can reach the team directly.
          </p>
        </section>
      )}

      <section className="space-y-3">
        <p className="text-xs text-muted-foreground">Host</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {DEPLOY_TARGETS.map((item) => {
            const active = target === item.value;
            return (
              <button
                key={item.value}
                type="button"
                disabled={deploying}
                onClick={() => setTarget(item.value)}
                className={cn(
                  "border bg-card p-4 text-left transition-colors hover:bg-accent",
                  active && "border-foreground/40",
                )}
              >
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="mt-1.5 block text-xs leading-5 text-muted-foreground">
                  {item.detail}
                </span>
              </button>
            );
          })}
        </div>
        {!deployment ? (
          <div className="flex items-center justify-between gap-4 border bg-card px-5 py-4">
            <p className="text-xs leading-5 text-muted-foreground">
              One action. The agent signs in to your host in the browser,
              builds the workspace and verifies it answers before reporting
              the URL.
            </p>
            {driver ? (
              <Button
                disabled={deploying || !org}
                onClick={() => {
                  setError(null);
                  setDeploying(true);
                }}
              >
                Deploy workspace
              </Button>
            ) : (
              <p className="shrink-0 text-xs text-muted-foreground">
                Choose an agent app first.
              </p>
            )}
          </div>
        ) : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {deploying && driver ? (
          <IntegrationSetupPanel
            domain={DEPLOY_PROVIDER}
            prompt={deployWorkspaceTask(target)}
            driver={driver}
            onResult={(result) => void persistResult(result)}
          />
        ) : null}
      </section>

      <section className="border bg-card">
        <div className="border-b px-5 py-3">
          <p className="text-sm font-medium">What ships</p>
        </div>
        <div className="divide-y">
          {team.map((agent) => (
            <div key={agent.id} className="flex items-baseline gap-4 px-5 py-3">
              <p className="w-32 shrink-0 font-serif text-base">{agent.name}</p>
              <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {agent.description}
              </p>
            </div>
          ))}
          <div className="flex items-baseline gap-4 px-5 py-3">
            <p className="w-32 shrink-0 font-serif text-base">Brand brief</p>
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              The context from your account setup primes every deployed
              session.
            </p>
          </div>
        </div>
      </section>

      <section className="border bg-card">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <p className="text-sm font-medium">Cloud schedules</p>
          <Link
            to="/schedule"
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Manage in Schedule
          </Link>
        </div>
        {cloudSchedules.length > 0 ? (
          <div className="divide-y">
            {cloudSchedules.map((work) => (
              <div
                key={work.id}
                className="flex items-baseline gap-4 px-5 py-3"
              >
                <p className="min-w-0 flex-1 truncate text-sm">{work.title}</p>
                <p className="shrink-0 font-mono text-xs text-muted-foreground">
                  {work.cron}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-4 text-xs leading-5 text-muted-foreground">
            Approved automations run on this Mac until you switch one to Cloud
            on its Schedule card. Cloud schedules take effect on the next
            deploy.
          </p>
        )}
      </section>

      <section className="border bg-card px-5 py-4">
        <p className="text-sm font-medium">Connected integrations in the cloud</p>
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
          Deployed agents reach integrations through a hosted Executor
          endpoint. Until one is configured, they answer from the brand brief
          and their schedules; your local agents keep full access here.
        </p>
      </section>
    </div>
  );
}
