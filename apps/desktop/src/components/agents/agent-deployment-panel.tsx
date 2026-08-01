/* eslint-disable max-lines */

import { useEffect, useMemo, useRef, useState } from "react";
import { Vercel } from "@lobehub/icons";

import type {
  AgentDefinition,
  AgentDeploymentPhase,
  AgentDeploymentTarget,
  InputRequest,
} from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";
import { cn } from "@chief/ui/lib/utils";

import type { AuthOrganization } from "../../lib/auth/better-auth-client";
import { useAgentDeployments } from "../../lib/agent-deployments";
import {
  AI_GATEWAY_API_KEY,
  AI_GATEWAY_INPUT_REQUEST,
  AI_GATEWAY_KEYS_URL,
} from "../../lib/ai-gateway-input";
import { useAuth } from "../../lib/auth/auth-context";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
  updateAuthOrganization,
} from "../../lib/auth/better-auth-client";
import { playbookInstructions, PLAYBOOKS } from "../../lib/playbooks";
import { useProviderModels, useStoredInputs } from "../../lib/runtime";
import { ConvexLogo } from "../convex-logo";

interface PersistedDeployment {
  url: string;
  target: AgentDeploymentTarget;
  deployedAt?: number;
  model?: string;
}

const PHASES: { phase: AgentDeploymentPhase; label: string }[] = [
  { phase: "preparing", label: "Prepare" },
  { phase: "authenticating", label: "Authenticate" },
  { phase: "linking", label: "Link project" },
  { phase: "configuring", label: "Configure" },
  { phase: "building", label: "Build" },
  { phase: "deploying", label: "Deploy" },
  { phase: "verifying", label: "Verify" },
];
const DEPLOYED_SLACK_KEYS = ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET"];
const DEPLOYED_SLACK_REQUEST: InputRequest = {
  id: "deployed-slack-credentials",
  title: "Slack deployment credentials",
  fields: [
    {
      key: "botToken",
      label: "Bot token",
      type: "secret",
      save: { envKey: "SLACK_BOT_TOKEN" },
    },
    {
      key: "signingSecret",
      label: "Signing secret",
      type: "secret",
      save: { envKey: "SLACK_SIGNING_SECRET" },
    },
  ],
};

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
  const agentDeployments =
    onboarding.agentDeployments &&
    typeof onboarding.agentDeployments === "object"
      ? (onboarding.agentDeployments as Record<string, unknown>)
      : {};
  const raw =
    agentDeployments[agentId] ??
    (agentId === "cmo" ? onboarding.chiefDeployment : undefined);
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.url !== "string" || !value.url) return null;
  return {
    url: value.url,
    target: value.target === "convex" ? "convex" : "vercel",
    deployedAt:
      typeof value.deployedAt === "number" ? value.deployedAt : undefined,
    model: typeof value.model === "string" ? value.model : undefined,
  };
}

function projectSlug(workspaceId: string | null, agentId: string) {
  const suffix = workspaceId?.replace(/[^a-z0-9]/gi, "").slice(-8) ?? "local";
  const agent = agentId.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  return `chief-${agent === "cmo" ? "" : `${agent}-`}${suffix}`.toLowerCase();
}

function phaseIndex(phase: AgentDeploymentPhase | undefined) {
  return PHASES.findIndex((item) => item.phase === phase);
}

export function AgentDeploymentPanel({
  agent,
  onBack,
}: {
  agent: AgentDefinition;
  onBack: () => void;
}) {
  const { cloudOrganizationId } = useAuth();
  const deploymentState = useAgentDeployments(cloudOrganizationId);
  const [org, setOrg] = useState<AuthOrganization | null>(null);
  const [target, setTarget] = useState<AgentDeploymentTarget>("vercel");
  const [scope, setScope] = useState("");
  const [gatewayKey, setGatewayKey] = useState("");
  const [model, setModel] = useState("");
  const [deploySlackDraft, setDeploySlack] = useState<boolean | null>(null);
  const [activateDeployment, setActivateDeployment] = useState(false);
  const [slackBotToken, setSlackBotToken] = useState("");
  const [slackSigningSecret, setSlackSigningSecret] = useState("");
  const [projectName, setProjectName] = useState(() =>
    projectSlug(cloudOrganizationId, agent.id),
  );
  const persistedUrl = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const current = deploymentState.deployments.find(
    (deployment) =>
      deployment.agentId === agent.id && deployment.target === target,
  );
  const deploySlack =
    target === "vercel" &&
    (deploySlackDraft ??
      Boolean(current?.channels && current.channels.length > 0));
  const gatewayModels = useProviderModels("remote");
  const gatewayInputs = useStoredInputs(
    target === "convex" ? [AI_GATEWAY_API_KEY] : null,
  );
  const slackInputs = useStoredInputs(
    target === "vercel" && deploySlack ? DEPLOYED_SLACK_KEYS : null,
  );
  const gatewayConfigured =
    target !== "convex" ||
    gatewayInputs.present?.has(AI_GATEWAY_API_KEY) === true;

  useEffect(() => {
    let cancelled = false;
    void listAuthOrganizations().then((organizations) => {
      if (cancelled) return;
      const next =
        organizations.find((item) => item.id === cloudOrganizationId) ??
        organizations[0] ??
        null;
      setOrg(next);
      const saved = persistedDeployment(next, agent.id);
      if (saved) setTarget(saved.target);
    });
    return () => {
      cancelled = true;
    };
  }, [agent.id, cloudOrganizationId]);

  const playbooks = useMemo(
    () =>
      PLAYBOOKS.filter(
        (playbook) =>
          playbook.agentId === agent.id ||
          agent.delegates?.includes(playbook.agentId),
      ).map((playbook) => ({
        id: playbook.id,
        title: playbook.title,
        summary: playbook.summary,
        instructions: playbookInstructions(playbook),
      })),
    [agent.delegates, agent.id],
  );
  const slackPresent = slackInputs.present;
  const slackConfigured =
    !deploySlack ||
    (slackPresent?.has("SLACK_BOT_TOKEN") === true &&
      slackPresent.has("SLACK_SIGNING_SECRET"));
  const saved = persistedDeployment(org, agent.id);
  const running = current?.status === "running";
  const currentPhase = phaseIndex(current?.phase);
  const projectNameValid =
    target === "convex"
      ? /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectName)
      : /^[a-z0-9][a-z0-9._-]{0,99}$/.test(projectName);
  const effectiveModel =
    model.length > 0
      ? model
      : (current?.model ?? saved?.model ?? "xai/grok-4.3");
  const selectedModel = gatewayModels.models.find(
    (option) => option.value === effectiveModel,
  );

  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [current?.logs.length]);

  useEffect(() => {
    if (!org || !current?.url || current.status !== "ready") return;
    if (persistedUrl.current === current.url) return;
    persistedUrl.current = current.url;
    const metadata = parseOrganizationMetadata(org);
    const onboarding =
      metadata.onboarding && typeof metadata.onboarding === "object"
        ? (metadata.onboarding as Record<string, unknown>)
        : {};
    const agentDeployments =
      onboarding.agentDeployments &&
      typeof onboarding.agentDeployments === "object"
        ? (onboarding.agentDeployments as Record<string, unknown>)
        : {};
    const deploymentMetadata = {
      url: current.url,
      target: current.target,
      deployedAt: current.updatedAt,
      model: current.model,
    };
    const nextMetadata = {
      ...metadata,
      onboarding: {
        ...onboarding,
        ...(current.activated && agent.id === "cmo"
          ? {
              provider: "remote",
              providerMode: "deployed",
              workspaceMode: "cloud",
              deploymentProvider: current.target,
              cloudDeploymentUrl: current.url,
            }
          : {}),
        agentDeployments: {
          ...agentDeployments,
          [agent.id]: deploymentMetadata,
        },
        ...(agent.id === "cmo" ? { chiefDeployment: deploymentMetadata } : {}),
      },
    };
    void updateAuthOrganization(org.id, { metadata: nextMetadata }).then(() =>
      setOrg({ ...org, metadata: nextMetadata }),
    );
  }, [agent.id, current, org]);

  return (
    <div className="flex min-h-[680px] flex-col">
      <header className="flex items-start justify-between gap-5 border-b p-6">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground mb-4 text-xs"
          >
            Back to {agent.name}
          </button>
          <h3 className="text-2xl font-medium tracking-[-0.035em]">
            Deploy {agent.name}
          </h3>
          <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-6">
            An isolated deployment of this agent pack, including its configured
            subagents, durable workspace tools, and authenticated remote chat.
          </p>
        </div>
        {current?.url || saved?.url ? (
          <a
            href={current?.url ?? saved?.url}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground max-w-72 truncate font-mono text-xs"
          >
            {current?.url ?? saved?.url}
          </a>
        ) : null}
      </header>

      <div className="grid flex-1 gap-0 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-6 border-r p-6">
          <section>
            <p className="text-xs font-medium">Deployment provider</p>
            <div className="mt-3 grid gap-2">
              <button
                type="button"
                disabled={running}
                onClick={() => setTarget("vercel")}
                className={cn(
                  "flex items-start gap-3 border p-3 text-left transition-colors",
                  target === "vercel"
                    ? "border-foreground bg-muted"
                    : "hover:border-foreground",
                )}
              >
                <Vercel size={16} className="mt-0.5" />
                <span>
                  <span className="block text-xs font-medium">Vercel</span>
                  <span className="text-muted-foreground mt-1 block text-[10px] leading-4">
                    Eve server, AI Gateway, and managed sandbox.
                  </span>
                </span>
              </button>
              <button
                type="button"
                disabled={running}
                onClick={() => setTarget("convex")}
                className={cn(
                  "flex items-start gap-3 border p-3 text-left transition-colors",
                  target === "convex"
                    ? "border-foreground bg-muted"
                    : "hover:border-foreground",
                )}
              >
                <ConvexLogo className="mt-0.5 size-4" />
                <span>
                  <span className="block text-xs font-medium">Convex</span>
                  <span className="text-muted-foreground mt-1 block text-[10px] leading-4">
                    Convex-native workflow state, queue, and streams.
                  </span>
                </span>
              </button>
            </div>
          </section>

          <section className="space-y-3 border-t pt-5">
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
              {!projectNameValid ? (
                <span className="text-destructive block text-[10px] leading-4">
                  {target === "convex"
                    ? "Use lowercase letters, numbers, and single hyphens."
                    : "Use a lowercase letter or number first, then letters, numbers, dots, underscores, or hyphens."}
                </span>
              ) : null}
            </label>
            <label className="block space-y-2 text-xs">
              <span>Gateway model</span>
              <Select
                value={effectiveModel}
                disabled={running}
                onValueChange={setModel}
              >
                <SelectTrigger className="w-full">
                  <span className="truncate">
                    {gatewayModels.loading
                      ? "Loading models..."
                      : (selectedModel?.label ?? effectiveModel)}
                  </span>
                </SelectTrigger>
                <SelectContent className="max-h-80 min-w-72">
                  {gatewayModels.models
                    .filter((option) => option.value)
                    .map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <span className="flex min-w-64 items-start justify-between gap-4">
                          <span>
                            <span className="block">{option.label}</span>
                            <span className="text-muted-foreground block font-mono text-[9px]">
                              {option.value}
                            </span>
                          </span>
                          {option.pricing ? (
                            <span className="text-muted-foreground font-mono text-[9px] whitespace-nowrap">
                              ${Number(option.pricing.input ?? 0) * 1_000_000} /
                              ${Number(option.pricing.output ?? 0) * 1_000_000}
                            </span>
                          ) : null}
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {selectedModel?.pricing ? (
                <span className="text-muted-foreground block text-[10px]">
                  ${Number(selectedModel.pricing.input ?? 0) * 1_000_000} input
                  / ${Number(selectedModel.pricing.output ?? 0) * 1_000_000}{" "}
                  output per 1M tokens
                </span>
              ) : null}
            </label>
            <label className="block space-y-2 text-xs">
              <span>{target === "vercel" ? "Team slug" : "Convex team"}</span>
              <Input
                value={scope}
                disabled={running}
                onChange={(event) => setScope(event.target.value)}
                placeholder="Optional; uses your current account"
              />
            </label>
            {target === "vercel" ? (
              <div className="space-y-3 border-t pt-4">
                <button
                  type="button"
                  disabled={running}
                  onClick={() => setDeploySlack(!deploySlack)}
                  className="flex w-full items-center justify-between text-left text-xs"
                >
                  <span>
                    <span className="block">Slack via Eve</span>
                    <span className="text-muted-foreground mt-1 block text-[10px]">
                      Webhook channel for Vercel deployments
                    </span>
                  </span>
                  <span
                    className={cn(
                      "h-4 w-7 border p-0.5",
                      deploySlack && "border-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "bg-muted-foreground block size-2.5 transition-transform",
                        deploySlack && "bg-foreground translate-x-2.5",
                      )}
                    />
                  </span>
                </button>
                {deploySlack ? (
                  slackConfigured ? (
                    <div className="space-y-2">
                      <p className="text-[10px] text-emerald-500">
                        Slack bot token and signing secret are stored.
                      </p>
                      {current?.url ? (
                        <p className="text-muted-foreground text-[10px] leading-4 break-all">
                          Set Slack Events and Interactivity to{" "}
                          {current.url.replace(/\/$/, "")}/eve/v1/slack
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Input
                        type="password"
                        value={slackBotToken}
                        onChange={(event) =>
                          setSlackBotToken(event.target.value)
                        }
                        placeholder="Slack bot token (xoxb-...)"
                        autoComplete="off"
                      />
                      <Input
                        type="password"
                        value={slackSigningSecret}
                        onChange={(event) =>
                          setSlackSigningSecret(event.target.value)
                        }
                        placeholder="Slack signing secret"
                        autoComplete="off"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          !slackBotToken || !slackSigningSecret || running
                        }
                        onClick={() => {
                          slackInputs.store(DEPLOYED_SLACK_REQUEST, {
                            botToken: slackBotToken,
                            signingSecret: slackSigningSecret,
                          });
                          setSlackBotToken("");
                          setSlackSigningSecret("");
                        }}
                      >
                        Save Slack credentials
                      </Button>
                    </div>
                  )
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              disabled={running}
              onClick={() => setActivateDeployment((value) => !value)}
              className="flex w-full items-center justify-between border-t pt-4 text-left text-xs"
            >
              <span>
                <span className="block">Connect to this workspace</span>
                <span className="text-muted-foreground mt-1 block text-[10px] leading-4">
                  {activateDeployment
                    ? `${agent.name} chats use this deployment`
                    : `Keep ${agent.name}'s local agent app unchanged`}
                </span>
              </span>
              <span
                className={cn(
                  "h-4 w-7 border p-0.5",
                  activateDeployment && "border-foreground",
                )}
              >
                <span
                  className={cn(
                    "bg-muted-foreground block size-2.5 transition-transform",
                    activateDeployment && "bg-foreground translate-x-2.5",
                  )}
                />
              </span>
            </button>
            {target === "convex" ? (
              gatewayInputs.present === null ? (
                <p className="text-muted-foreground text-[10px]">
                  Checking the workspace Keychain vault...
                </p>
              ) : gatewayConfigured ? (
                <p className="text-[10px] text-emerald-500">
                  AI Gateway key stored in this workspace's Keychain vault.
                </p>
              ) : (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-muted-foreground text-[10px] leading-4">
                    Convex needs an AI Gateway API key. It stays in this
                    workspace's macOS Keychain vault.{" "}
                    <a
                      href={AI_GATEWAY_KEYS_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground underline underline-offset-2"
                    >
                      Create a key in Vercel
                    </a>
                    .
                  </p>
                  <Input
                    type="password"
                    value={gatewayKey}
                    disabled={running}
                    autoComplete="off"
                    placeholder="AI Gateway API key"
                    onChange={(event) => setGatewayKey(event.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!gatewayKey || running}
                    onClick={() => {
                      gatewayInputs.store(AI_GATEWAY_INPUT_REQUEST, {
                        apiKey: gatewayKey,
                      });
                      setGatewayKey("");
                    }}
                  >
                    Save key
                  </Button>
                </div>
              )
            ) : null}
          </section>

          <section className="border-t pt-5">
            <div className="space-y-3">
              {PHASES.map((item, index) => {
                const complete =
                  current?.status === "ready" || index < currentPhase;
                const active = running && index === currentPhase;
                const failed =
                  current?.status === "failed" && index === currentPhase;
                const warning =
                  current?.status === "needs_configuration" &&
                  item.phase === "configuring";
                return (
                  <div
                    key={item.phase}
                    className="flex items-center gap-3 text-xs"
                  >
                    <span
                      className={cn(
                        "bg-muted-foreground/30 size-2 rounded-full",
                        complete && "bg-emerald-500",
                        active && "animate-pulse bg-blue-500",
                        failed && "bg-red-500",
                        warning && "bg-yellow-500",
                      )}
                    />
                    <span
                      className={cn(
                        "text-muted-foreground",
                        (active || complete || warning) && "text-foreground",
                      )}
                    >
                      {item.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </aside>

        <main className="flex min-h-0 flex-col">
          <div className="flex items-start justify-between gap-4 border-b p-5">
            <div>
              <p className="text-sm font-medium capitalize">
                {current?.phase ??
                  current?.status.replaceAll("_", " ") ??
                  "Ready to deploy"}
              </p>
              <p className="text-muted-foreground mt-1 text-xs leading-5">
                {current?.detail ??
                  `${target === "vercel" ? "Vercel" : "Convex"} authentication opens in your browser when required.`}
              </p>
            </div>
            <span
              className={cn(
                "mt-1 size-2",
                current?.status === "ready"
                  ? "bg-emerald-500"
                  : current?.status === "failed"
                    ? "bg-red-500"
                    : running
                      ? "animate-pulse bg-blue-500"
                      : current?.status === "needs_configuration"
                        ? "bg-yellow-500"
                        : "bg-muted-foreground/30",
              )}
            />
          </div>

          <div
            ref={logRef}
            role="log"
            aria-live="polite"
            className="h-[430px] max-h-[50vh] overflow-y-auto bg-black/30 p-5 font-mono text-[11px] leading-5"
          >
            {current?.logs.length ? (
              current.logs.map((line, index) => (
                <p key={`${index}-${line}`} className="break-all">
                  <span className="text-muted-foreground mr-3 select-none">
                    {String(index + 1).padStart(3, "0")}
                  </span>
                  {line}
                </p>
              ))
            ) : (
              <p className="text-muted-foreground">
                Deployment output will stream here in real time.
              </p>
            )}
          </div>

          <footer className="flex items-center justify-between gap-4 border-t p-5">
            <p className="text-muted-foreground text-xs">
              {current?.status === "ready"
                ? current.activated
                  ? `Live on ${current.target}. ${agent.name} chats use this deployment.`
                  : `Live on ${current.target}. ${agent.name}'s local agent app is unchanged.`
                : `Existing provider login is reused. ${agent.name} never reads its credential.`}
            </p>
            {running ? (
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
                  !projectNameValid ||
                  !gatewayConfigured ||
                  !slackConfigured ||
                  !org
                }
                onClick={() =>
                  deploymentState.start({
                    agentId: agent.id,
                    target,
                    projectName: projectName.trim(),
                    teamId: scope.trim() || undefined,
                    model: effectiveModel,
                    playbooks,
                    channels: deploySlack ? [{ kind: "slack" }] : undefined,
                    activate: activateDeployment,
                  })
                }
              >
                {current?.status === "ready"
                  ? `Redeploy ${agent.name}`
                  : `Deploy ${agent.name}`}
              </Button>
            )}
          </footer>
        </main>
      </div>
    </div>
  );
}
