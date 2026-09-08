import { useState } from "react";
import { Users } from "lucide-react";

import type { AgentDefinition } from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import { Button } from "@chief/ui/components/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@chief/ui/components/select";

import type {
  AgentExecution,
  NativeDeployment,
  NativeExecutionDraft,
} from "../../lib/agent-execution";
import { selectDeployment } from "../../lib/agent-execution";
import { PROVIDER_META } from "../../lib/providers";
import { useProviderModels } from "../../lib/runtime";
import {
  nativeProvidersForDeployment,
  verifyEveConnectionWithRetry,
} from "./agent-connection-model";
import {
  AgentEveDeploymentPanel,
  hasEveDeploymentDraft,
} from "./agent-eve-deployment-panel";
import {
  AgentExecutionError,
  deploymentKey,
  DeploymentOption,
  executionDescription,
  isDeploymentKind,
  isProvider,
  modelForProvider,
  ProviderOption,
} from "./agent-execution-options";

export function AgentExecutionCard({
  agent,
  execution,
  ready,
  saving,
  error,
  onApply,
  onApplyToTeam,
  relayClient,
  onExternalAgentChanged,
}: {
  agent: AgentDefinition;
  execution: AgentExecution;
  ready: boolean;
  saving: boolean;
  error: string | null;
  onApply: (draft: NativeExecutionDraft) => void;
  onApplyToTeam: (draft: NativeExecutionDraft) => void;
  relayClient?: RelayClient | null;
  onExternalAgentChanged?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<NativeExecutionDraft | null>(null);
  const [deployingToEve, setDeployingToEve] = useState(() =>
    hasEveDeploymentDraft(agent.id),
  );
  const agentId = agent.id;
  const agentName = agent.name;
  const nativeDeployment: NativeDeployment | null =
    execution.deployment.kind === "vercel-eve" ? null : execution.deployment;
  const configured =
    execution.inference.kind === "configured" ? execution.inference : null;
  const selectedDeployment: NativeDeployment = draft?.deployment ??
    nativeDeployment ?? { kind: "chief-cloud" };
  const selectedProvider = draft?.provider ?? configured?.provider ?? null;
  const selectedModel = draft?.model ?? configured?.model ?? "";
  const providerModels = useProviderModels(selectedProvider);

  if (execution.deployment.kind === "vercel-eve") {
    return (
      <>
        <ExternalAgentExecutionCard
          agentName={agentName}
          agentId={agentId}
          connectionStatus={execution.deployment.connectionStatus}
          client={relayClient?.externalAgents ?? null}
          onChanged={onExternalAgentChanged}
          onDeploy={() => setDeployingToEve(true)}
        />
        {deployingToEve ? (
          <AgentEveDeploymentPanel
            agent={agent}
            client={relayClient ?? null}
            onCancel={() => setDeployingToEve(false)}
            onDeployed={onExternalAgentChanged}
          />
        ) : null}
      </>
    );
  }

  const models = providerModels.models.filter(
    (item) => selectedProvider !== "remote" || item.value !== "",
  );
  const meta = selectedProvider ? PROVIDER_META[selectedProvider] : null;
  const changed = Boolean(
    draft &&
    (configured === null ||
      nativeDeployment === null ||
      deploymentKey(draft.deployment) !== deploymentKey(nativeDeployment) ||
      draft.provider !== configured.provider ||
      draft.model !== configured.model),
  );
  const apply = (team: boolean) => {
    if (!draft) return;
    if (team) onApplyToTeam(draft);
    else onApply(draft);
    setDraft(null);
  };

  return (
    <div className="bg-muted/25 mt-6 rounded-2xl px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium">Runtime and model</p>
          <p className="text-muted-foreground mt-0.5 text-[12px] leading-5 font-normal">
            {deployingToEve
              ? `${agentName} will run in Vercel Eve and connect through the Chief relay.`
              : executionDescription({
                  agentName,
                  deployment: selectedDeployment,
                  provider: meta?.label,
                })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={deployingToEve ? "vercel-eve" : selectedDeployment.kind}
            disabled={!ready}
            onValueChange={(value) => {
              if (value === "vercel-eve") {
                setDraft(null);
                setDeployingToEve(true);
                return;
              }
              if (!isDeploymentKind(value)) return;
              setDeployingToEve(false);
              const deployment = selectDeployment({
                kind: value,
                current: selectedDeployment,
              });
              const provider =
                deployment.kind === "chief-cloud"
                  ? (selectedProvider ?? "remote")
                  : selectedProvider === "remote"
                    ? "opencode"
                    : (selectedProvider ?? "opencode");
              setDraft({
                deployment,
                provider,
                model: modelForProvider(
                  provider,
                  selectedProvider,
                  selectedModel,
                ),
              });
            }}
          >
            <SelectTrigger className="bg-background/70 h-9 w-auto min-w-36 rounded-xl px-2.5 text-xs">
              <DeploymentOption
                deployment={
                  deployingToEve
                    ? {
                        kind: "vercel-eve",
                        connectionStatus: "pending_setup",
                      }
                    : selectedDeployment
                }
              />
            </SelectTrigger>
            <SelectContent className="min-w-40">
              <SelectGroup>
                <SelectLabel>Runs on</SelectLabel>
                <SelectItem value="chief-cloud">
                  <DeploymentOption
                    deployment={selectDeployment({
                      kind: "chief-cloud",
                      current: selectedDeployment,
                    })}
                  />
                </SelectItem>
                <SelectItem value="vercel-eve">
                  <DeploymentOption
                    deployment={{
                      kind: "vercel-eve",
                      connectionStatus: "pending_setup",
                    }}
                  />
                </SelectItem>
                <SelectItem value="on-device">
                  <DeploymentOption
                    deployment={selectDeployment({
                      kind: "on-device",
                      current: selectedDeployment,
                    })}
                  />
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {!deployingToEve ? (
            <Select
              value={selectedProvider ?? undefined}
              disabled={!ready}
              onValueChange={(value) => {
                if (!isProvider(value)) return;
                setDraft({
                  deployment: selectedDeployment,
                  provider: value,
                  model: modelForProvider(
                    value,
                    selectedProvider,
                    selectedModel,
                  ),
                });
              }}
            >
              <SelectTrigger className="bg-background/70 h-9 w-auto min-w-40 rounded-xl px-2.5 text-xs">
                {meta ? (
                  <span className="flex items-center gap-2">
                    <meta.Icon size={14} />
                    {meta.label}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Choose provider</span>
                )}
              </SelectTrigger>
              <SelectContent className="min-w-40">
                <SelectGroup>
                  <SelectLabel>Agent providers</SelectLabel>
                  {nativeProvidersForDeployment(selectedDeployment.kind).map(
                    (provider) => (
                      <SelectItem key={provider} value={provider}>
                        <ProviderOption provider={provider} />
                      </SelectItem>
                    ),
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : null}
          {!deployingToEve && selectedProvider ? (
            <Select
              value={selectedModel}
              disabled={!ready || providerModels.loading}
              onValueChange={(value) =>
                setDraft({
                  deployment: selectedDeployment,
                  provider: selectedProvider,
                  model: value,
                })
              }
            >
              <SelectTrigger className="bg-background/70 h-9 w-auto max-w-56 min-w-40 rounded-xl px-2.5 text-xs">
                <span className="truncate">
                  {providerModels.loading
                    ? "Loading…"
                    : (models.find((item) => item.value === selectedModel)
                        ?.label ?? selectedModel)}
                </span>
              </SelectTrigger>
              <SelectContent className="max-h-72 min-w-56">
                {models.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </div>

      {!configured && ready ? (
        <AgentExecutionError
          message={`${agentName} needs an agent provider.`}
        />
      ) : null}
      {error ? <AgentExecutionError message={error} /> : null}
      {deployingToEve ? (
        <AgentEveDeploymentPanel
          agent={agent}
          client={relayClient ?? null}
          onCancel={() => setDeployingToEve(false)}
          onDeployed={onExternalAgentChanged}
        />
      ) : null}
      {changed ? (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!ready || saving}
            onClick={() => apply(true)}
          >
            <Users size={13} />
            Apply to team
          </Button>
          <Button
            size="sm"
            disabled={!ready || saving}
            onClick={() => apply(false)}
          >
            {saving ? "Saving…" : `Apply to ${agentName}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ExternalAgentExecutionCard({
  agentId,
  agentName,
  connectionStatus,
  client,
  onChanged,
  onDeploy,
}: {
  agentId: string;
  agentName: string;
  connectionStatus: "pending_setup" | "connected" | "degraded";
  client: RelayClient["externalAgents"] | null;
  onChanged?: () => Promise<void>;
  onDeploy: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const verify = async () => {
    if (!client) return;
    setWorking(true);
    setActionError(null);
    try {
      await verifyEveConnectionWithRetry(client, agentId);
      await onChanged?.();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Chief could not verify this Eve agent.",
      );
    } finally {
      setWorking(false);
    }
  };
  return (
    <div className="bg-muted/25 mt-6 rounded-2xl px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium">Runtime</p>
          <p className="text-muted-foreground mt-0.5 text-[12px] leading-5 font-normal">
            {agentName} runs in Vercel Eve and connects through the Chief relay.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!client || working}
          onClick={onDeploy}
        >
          Update deployment
        </Button>
        <Select value="vercel-eve" disabled>
          <SelectTrigger className="bg-background/70 h-9 w-auto min-w-36 rounded-xl px-2.5 text-xs">
            <DeploymentOption
              deployment={{ kind: "vercel-eve", connectionStatus }}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Runs on</SelectLabel>
              <SelectItem value="vercel-eve">
                <DeploymentOption
                  deployment={{ kind: "vercel-eve", connectionStatus }}
                />
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      {connectionStatus !== "connected" ? (
        <div className="mt-3">
          {working ? (
            <p className="text-muted-foreground text-[12px] leading-5">
              Chief is updating the Vercel project and preparing a new
              deployment.
            </p>
          ) : (
            <AgentExecutionError
              message={
                connectionStatus === "pending_setup"
                  ? "This Eve deployment has not been connected to Chief yet."
                  : "Chief cannot currently reach this Eve deployment."
              }
            />
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              size="sm"
              disabled={!client || working}
              onClick={() => void verify()}
            >
              {working ? "Checking…" : "Verify connection"}
            </Button>
          </div>
          {actionError ? (
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-destructive text-[12px] leading-5">
                {actionError}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                {actionError.includes("Reconnect Vercel") ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.location.assign("/plugins")}
                  >
                    Reconnect Vercel
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
