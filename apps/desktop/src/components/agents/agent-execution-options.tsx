import { Vercel } from "@lobehub/icons";
import { CircleAlert, Laptop } from "lucide-react";

import type { DriverType } from "@chief/agent-runtime/types";

import type {
  AgentDeployment,
  NativeDeployment,
} from "../../lib/agent-execution";
import type { Provider } from "../../lib/providers";
import { PROVIDER_META } from "../../lib/providers";
import { ChiefMark } from "../chief-mark";

export function AgentExecutionError({ message }: { message: string }) {
  return (
    <div className="border-destructive/20 bg-destructive/5 mt-3 flex items-start gap-2.5 rounded-xl border px-3 py-2.5">
      <CircleAlert size={14} className="text-destructive mt-0.5 shrink-0" />
      <p className="text-muted-foreground text-[12px] leading-5 font-normal">
        {message}
      </p>
    </div>
  );
}

export function ProviderOption({ provider }: { provider: Provider }) {
  const { label, Icon } = PROVIDER_META[provider];
  return (
    <span className="flex items-center gap-2">
      <Icon size={14} />
      {label}
    </span>
  );
}

export function DeploymentOption({
  deployment,
}: {
  deployment: AgentDeployment;
}) {
  if (deployment.kind === "chief-cloud") {
    return (
      <span className="flex items-center gap-2">
        <ChiefMark className="size-3.5" />
        Chief relay
      </span>
    );
  }
  if (deployment.kind === "vercel-eve") {
    return (
      <span className="flex items-center gap-2">
        <Vercel size={14} />
        Vercel Eve
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <Laptop size={14} />
      On device
    </span>
  );
}

export function executionDescription({
  agentName,
  deployment,
  provider,
}: {
  agentName: string;
  deployment: NativeDeployment;
  provider?: string;
}) {
  const location =
    deployment.kind === "chief-cloud"
      ? "through the Chief relay"
      : "on your device";
  return provider
    ? `${agentName} runs ${location} using ${provider}.`
    : `${agentName} runs ${location}. Choose an agent provider.`;
}

export function deploymentKey(deployment: NativeDeployment) {
  return deployment.kind === "chief-cloud"
    ? deployment.kind
    : `${deployment.kind}:${deployment.relayTarget}`;
}

export function modelForProvider(
  provider: DriverType,
  previousProvider: DriverType | null,
  previousModel: string,
) {
  if (provider === previousProvider) return previousModel;
  return provider === "remote"
    ? "deepseek/deepseek-v4-flash"
    : provider === "opencode"
      ? "opencode-go/deepseek-v4-flash"
      : "auto";
}

export function isProvider(value: string): value is Provider {
  return ["claude", "codex", "opencode", "remote"].includes(value);
}

export function isDeploymentKind(
  value: string,
): value is NativeDeployment["kind"] {
  return value === "chief-cloud" || value === "on-device";
}
