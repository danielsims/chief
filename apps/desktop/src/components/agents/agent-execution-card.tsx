import { useState } from "react";
import { CircleAlert, Cloud, Laptop, Smartphone, Users } from "lucide-react";

import type { DriverType } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@chief/ui/components/select";

import type { Provider } from "../../lib/providers";
import { PROVIDER_META } from "../../lib/providers";
import { useProviderModels } from "../../lib/runtime";

export type DeploymentTarget = "phone" | "desktop" | "cloud";

interface ExecutionDraft {
  deploymentTarget: DeploymentTarget;
  driver: DriverType;
  model: string;
}

export function AgentExecutionCard({
  agentName,
  deploymentTarget,
  driver,
  model,
  ready,
  saving,
  error,
  onApply,
  onApplyToTeam,
}: {
  agentName: string;
  deploymentTarget: DeploymentTarget;
  driver: DriverType | null;
  model: string;
  ready: boolean;
  saving: boolean;
  error: string | null;
  onApply: (draft: ExecutionDraft) => void;
  onApplyToTeam: (draft: ExecutionDraft) => void;
}) {
  const [draft, setDraft] = useState<ExecutionDraft | null>(null);
  const selectedTarget = draft?.deploymentTarget ?? deploymentTarget;
  const selectedDriver = draft?.driver ?? driver;
  const selectedModel = draft?.model ?? model;
  const providerModels = useProviderModels(
    selectedDriver === "remote" ? null : selectedDriver,
  );
  const models =
    selectedDriver === "remote"
      ? [{ value: "opencode-go/deepseek-v4-flash", label: "DeepSeek V4 Flash" }]
      : providerModels.models;
  const meta = selectedDriver ? PROVIDER_META[selectedDriver] : null;
  const changed = Boolean(
    selectedDriver &&
    (selectedTarget !== deploymentTarget ||
      selectedDriver !== driver ||
      selectedModel !== model),
  );
  const apply = (team: boolean) => {
    if (!selectedDriver) return;
    const selection = {
      deploymentTarget: selectedTarget,
      driver: selectedDriver,
      model: selectedModel,
    };
    if (team) onApplyToTeam(selection);
    else onApply(selection);
    setDraft(null);
  };

  return (
    <div className="bg-muted/25 mt-6 rounded-2xl px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium">Agent provider and model</p>
          <p className="text-muted-foreground mt-0.5 text-[11px]">
            {meta
              ? `${agentName} runs through ${meta.label}.`
              : "Choose the provider that runs this agent."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selectedTarget}
            disabled={!ready}
            onValueChange={(value) => {
              if (!isDeploymentTarget(value)) return;
              setDraft({
                deploymentTarget: value,
                driver: value === "cloud" ? "remote" : "opencode",
                model: "opencode-go/deepseek-v4-flash",
              });
            }}
          >
            <SelectTrigger className="bg-background/70 h-9 w-auto min-w-36 rounded-xl px-2.5 text-xs">
              <DeploymentOption target={selectedTarget} />
            </SelectTrigger>
            <SelectContent className="min-w-40">
              <SelectGroup>
                <SelectLabel>Runs on</SelectLabel>
                {(["cloud", "desktop", "phone"] as const).map((target) => (
                  <SelectItem key={target} value={target}>
                    <DeploymentOption target={target} />
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={selectedDriver ?? undefined}
            disabled={!ready}
            onValueChange={(value) => {
              if (!isDriverType(value)) return;
              setDraft({
                deploymentTarget: selectedTarget,
                driver: value,
                model: "opencode-go/deepseek-v4-flash",
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
                <SelectItem
                  value={selectedTarget === "cloud" ? "remote" : "opencode"}
                >
                  <ProviderOption
                    provider={
                      selectedTarget === "cloud" ? "remote" : "opencode"
                    }
                  />
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {selectedDriver ? (
            <Select
              value={selectedModel}
              disabled={!ready}
              onValueChange={(value) =>
                setDraft({
                  deploymentTarget: selectedTarget,
                  driver: selectedDriver,
                  model: value,
                })
              }
            >
              <SelectTrigger className="bg-background/70 h-9 w-auto max-w-56 min-w-40 rounded-xl px-2.5 text-xs">
                <span className="truncate">
                  {providerModels.loading && selectedDriver !== "remote"
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

      {!driver ? (
        <AgentExecutionError message={`${agentName} needs OpenCode.`} />
      ) : null}
      {error ? <AgentExecutionError message={error} /> : null}
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

function AgentExecutionError({ message }: { message: string }) {
  return (
    <div className="border-destructive/20 bg-destructive/5 mt-3 flex items-start gap-2.5 rounded-xl border px-3 py-2.5">
      <CircleAlert size={14} className="text-destructive mt-0.5 shrink-0" />
      <p className="text-muted-foreground text-[11px] leading-4">{message}</p>
    </div>
  );
}

function ProviderOption({ provider }: { provider: Provider }) {
  const { label, Icon } = PROVIDER_META[provider];
  return (
    <span className="flex items-center gap-2">
      <Icon size={14} />
      {label}
    </span>
  );
}

function DeploymentOption({ target }: { target: DeploymentTarget }) {
  const detail = {
    cloud: { label: "Chief Cloud", Icon: Cloud },
    desktop: { label: "This Mac", Icon: Laptop },
    phone: { label: "Phone", Icon: Smartphone },
  }[target];
  return (
    <span className="flex items-center gap-2">
      <detail.Icon size={14} />
      {detail.label}
    </span>
  );
}

function isDriverType(value: string): value is DriverType {
  return value === "opencode" || value === "remote";
}

function isDeploymentTarget(value: string): value is DeploymentTarget {
  return value === "phone" || value === "desktop" || value === "cloud";
}
