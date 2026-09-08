import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { OpenCode, Vercel } from "@lobehub/icons";
import { ArrowLeft, Check } from "lucide-react";

import type {
  VercelProjectOption,
  VercelTeamOption,
} from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";

import type {
  EveProjectMode,
  WorkspaceAgentRuntime,
  WorkspaceInferenceProvider,
} from "./workspace-create-draft";
import { ChiefMark } from "../components/chief-mark";
import {
  VercelCredentialField,
  VercelDestinationFields,
} from "../components/vercel-connection";
import { providerCredentialHelp } from "../lib/provider-credential-help";
import {
  ProviderOption,
  workspaceOnboardingAppLogo,
  workspaceOnboardingApps,
} from "./workspace-create-options";

export function CreateForm({
  name,
  website,
  provider,
  apiKey,
  vercelAccessToken,
  selectedApps,
  working,
  connected,
  agentRuntime,
  eveDestination,
  relayRuntimeLabel,
  error,
  step,
  onNameChange,
  onWebsiteChange,
  onAgentRuntimeChange,
  onProviderChange,
  onApiKeyChange,
  onVercelAccessTokenChange,
  onEveDestinationChange,
  onSelectedAppsChange,
  onStepChange,
  onBackToHome,
  onSubmit,
}: {
  name: string;
  website: string;
  provider: WorkspaceInferenceProvider;
  apiKey: string;
  vercelAccessToken: string;
  selectedApps: ReadonlySet<string>;
  working: boolean;
  connected: boolean;
  agentRuntime: WorkspaceAgentRuntime;
  eveDestination: {
    loading: boolean;
    teamId: string;
    projectMode: EveProjectMode;
    projectId: string;
    projectName: string;
    teams: readonly VercelTeamOption[];
    projects: readonly VercelProjectOption[];
    ready: boolean;
  };
  relayRuntimeLabel: string;
  error: string | null;
  step: number;
  onNameChange: (value: string) => void;
  onWebsiteChange: (value: string) => void;
  onAgentRuntimeChange: (value: WorkspaceAgentRuntime) => void;
  onProviderChange: (value: Exclude<WorkspaceInferenceProvider, null>) => void;
  onApiKeyChange: (value: string) => void;
  onVercelAccessTokenChange: (value: string) => void;
  onEveDestinationChange: {
    onTeam: (value: string) => void;
    onMode: (value: EveProjectMode) => void;
    onProject: (value: string) => void;
    onProjectName: (value: string) => void;
  };
  onSelectedAppsChange: (value: Set<string>) => void;
  onStepChange: (value: number) => void;
  onBackToHome: () => void;
  onSubmit: () => void;
}) {
  const appListRef = useRef<HTMLDivElement>(null);
  const [canScrollApps, setCanScrollApps] = useState(false);
  const updateAppScrollCue = useCallback(() => {
    const element = appListRef.current;
    setCanScrollApps(
      Boolean(
        element &&
        element.scrollHeight - element.scrollTop - element.clientHeight > 4,
      ),
    );
  }, []);
  const lastStep = 3;
  const destinationStep = agentRuntime === "vercel-eve" ? 2 : -1;
  const inferenceStep = agentRuntime === "relay-cell" ? 2 : -1;
  const appsStep = lastStep;
  useEffect(() => {
    if (step !== appsStep) return;
    const frame = requestAnimationFrame(updateAppScrollCue);
    window.addEventListener("resize", updateAppScrollCue);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateAppScrollCue);
    };
  }, [appsStep, step, updateAppScrollCue]);
  const advance = (event: React.FormEvent) => {
    event.preventDefault();
    if (step < lastStep) {
      onStepChange(step + 1);
      return;
    }
    onSubmit();
  };
  const canContinue =
    step === 0
      ? Boolean(name.trim())
      : step === 1
        ? agentRuntime === "relay-cell" || Boolean(vercelAccessToken.trim())
        : step === destinationStep
          ? eveDestination.ready
          : step === inferenceStep
            ? provider !== null && Boolean(apiKey.trim())
            : true;
  const back = () => {
    if (step === 0) onBackToHome();
    else onStepChange(step - 1);
  };

  return (
    <form onSubmit={advance} className="space-y-6">
      <button
        type="button"
        onClick={back}
        disabled={working}
        className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 text-[13px] transition-colors disabled:opacity-50"
      >
        <ArrowLeft size={14} />
        Back
      </button>
      <QuestionHeader
        title={
          step === 0
            ? "What’s the name of this workspace?"
            : step === 1
              ? "Where will you deploy your agents?"
              : step === destinationStep
                ? "Choose a Vercel project"
                : step === inferenceStep
                  ? "Which inference provider should your agents use?"
                  : "What apps do you already use?"
        }
        detail={
          step === 0
            ? "Add a website if there’s one your agents should understand."
            : step === 1
              ? "Choose the default runtime for this workspace. You can connect other agent deployments later."
              : step === destinationStep
                ? "Chief and its subagents will deploy as one Eve project. The workspace is created when you finish this form."
                : step === inferenceStep
                  ? "Choose how this agent deployment accesses its models."
                  : "Choose the apps your team already uses."
        }
      />

      <div>
        {step === 0 ? (
          <div className="space-y-4">
            <Field label="Workspace name" htmlFor="new-workspace-name">
              <Input
                id="new-workspace-name"
                autoFocus
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="Acme"
                disabled={working}
              />
            </Field>
            <Field label="Website" optional htmlFor="new-workspace-website">
              <Input
                id="new-workspace-website"
                value={website}
                onChange={(event) => onWebsiteChange(event.target.value)}
                placeholder="acme.com"
                disabled={working}
              />
            </Field>
          </div>
        ) : step === 1 ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <ProviderOption
                label={relayRuntimeLabel}
                detail="Run Chief and its subagents in the Cell runtime attached to this relay."
                selected={agentRuntime === "relay-cell"}
                onClick={() => onAgentRuntimeChange("relay-cell")}
                icon={<ChiefMark className="size-7" />}
              />
              <ProviderOption
                label="Vercel Eve"
                detail="Deploy Chief and its subagents as one Vercel Eve project."
                selected={agentRuntime === "vercel-eve"}
                onClick={() => onAgentRuntimeChange("vercel-eve")}
                icon={<Vercel size={27} />}
              />
            </div>
            {agentRuntime === "vercel-eve" ? (
              <div className="border-t pt-4">
                <VercelCredentialField
                  credentialKind="account-access-token"
                  value={vercelAccessToken}
                  disabled={working}
                  onChange={onVercelAccessTokenChange}
                />
              </div>
            ) : null}
          </div>
        ) : step === destinationStep ? (
          <VercelDestinationFields
            loading={eveDestination.loading}
            mode={eveDestination.projectMode}
            projectId={eveDestination.projectId}
            projectName={eveDestination.projectName}
            projects={eveDestination.projects}
            teamId={eveDestination.teamId}
            teams={eveDestination.teams}
            onMode={onEveDestinationChange.onMode}
            onProject={onEveDestinationChange.onProject}
            onProjectName={onEveDestinationChange.onProjectName}
            onTeam={onEveDestinationChange.onTeam}
          />
        ) : step === inferenceStep ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <ProviderOption
                label="Vercel AI Gateway"
                detail="Use models available through Vercel AI Gateway."
                selected={provider === "vercelAiGateway"}
                onClick={() => onProviderChange("vercelAiGateway")}
                icon={<Vercel size={27} />}
              />
              <ProviderOption
                label="OpenCode"
                detail="Run inference through OpenCode on the relay."
                selected={provider === "opencode"}
                onClick={() => onProviderChange("opencode")}
                icon={<OpenCode size={27} />}
              />
            </div>
            {provider === "vercelAiGateway" ? (
              <VercelCredentialField
                credentialKind="ai-gateway-api-key"
                value={apiKey}
                disabled={working}
                onChange={onApiKeyChange}
              />
            ) : provider === "opencode" ? (
              <Field label="OpenCode API key" htmlFor="cloud-api-key">
                <Input
                  id="cloud-api-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => onApiKeyChange(event.target.value)}
                  placeholder="sk-…"
                  disabled={working}
                />
                <a
                  className="text-muted-foreground hover:text-foreground mt-2 inline-block text-xs transition-colors"
                  href={providerCredentialHelp["opencode-access-token"].url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {providerCredentialHelp["opencode-access-token"].label}
                </a>
              </Field>
            ) : null}
          </div>
        ) : (
          <div className="relative">
            <div
              ref={appListRef}
              onScroll={updateAppScrollCue}
              className="grid max-h-[368px] grid-cols-2 gap-2 overflow-y-auto pr-1 pb-16 sm:grid-cols-3"
            >
              {workspaceOnboardingApps.map((app) => {
                const selected = selectedApps.has(app.domain);
                return (
                  <button
                    key={app.domain}
                    type="button"
                    onClick={() => {
                      const next = new Set(selectedApps);
                      if (selected) next.delete(app.domain);
                      else next.add(app.domain);
                      onSelectedAppsChange(next);
                    }}
                    className={`hover:border-foreground/60 flex items-center gap-2 rounded-xl border p-3 text-left transition-colors ${selected ? "border-foreground bg-muted" : "bg-background"}`}
                  >
                    <img
                      src={workspaceOnboardingAppLogo(app.domain)}
                      alt=""
                      loading="eager"
                      decoding="async"
                      className="size-6 rounded-md object-contain"
                    />
                    <span className="min-w-0 truncate text-sm font-medium">
                      {app.label}
                    </span>
                    {selected ? (
                      <Check className="ml-auto shrink-0" size={14} />
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div
              aria-hidden
              className={`to-background pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent transition-opacity duration-200 ${canScrollApps ? "opacity-100" : "opacity-0"}`}
            />
          </div>
        )}
      </div>

      {error ? (
        <p className="bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-xs leading-5">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end pt-1">
        <Button
          type="submit"
          disabled={!canContinue || working || !connected}
          loading={working}
        >
          {working && agentRuntime === "vercel-eve" && step === 1
            ? "Checking Vercel…"
            : working && agentRuntime === "vercel-eve" && step === lastStep
              ? "Creating workspace…"
              : step === lastStep
                ? "Create workspace"
                : "Continue"}
        </Button>
      </div>
    </form>
  );
}

function QuestionHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mt-1 min-h-[92px]">
      <h1 className="text-[28px] leading-tight font-normal tracking-[-0.035em]">
        {title}
      </h1>
      <p className="text-muted-foreground mt-2 text-sm leading-6">{detail}</p>
    </div>
  );
}

export function JoinForm({
  invite,
  preview,
  working,
  connected,
  onInviteChange,
  onPrepare,
  onJoin,
}: {
  invite: string;
  preview: {
    workspaceName: string;
    conversationName: string | null;
  } | null;
  working: boolean;
  connected: boolean;
  onInviteChange: (value: string) => void;
  onPrepare: () => void;
  onJoin: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[32px] leading-tight font-normal tracking-[-0.04em]">
          Join a workspace
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Paste the invitation link you received.
        </p>
      </div>
      {preview ? (
        <div className="border-y py-4">
          <p className="text-sm font-medium">{preview.workspaceName}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            {preview.conversationName
              ? `You’ll join #${preview.conversationName}.`
              : "You’ll join this workspace."}
          </p>
        </div>
      ) : (
        <Field label="Invitation link" htmlFor="workspace-invite">
          <Input
            id="workspace-invite"
            autoFocus
            value={invite}
            onChange={(event) => onInviteChange(event.target.value)}
            placeholder="https://…/invite/…"
            disabled={working}
          />
        </Field>
      )}
      <div className="flex justify-end border-t pt-4">
        <Button
          disabled={!invite.trim() || working || !connected}
          loading={working}
          onClick={preview ? onJoin : onPrepare}
        >
          {preview ? "Join workspace" : "Continue"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  optional = false,
  htmlFor,
  children,
}: {
  label: string;
  optional?: boolean;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="text-[13px] font-medium" htmlFor={htmlFor}>
        {label}
        {optional ? (
          <span className="text-muted-foreground ml-1 font-normal">
            Optional
          </span>
        ) : null}
      </label>
      {children}
    </div>
  );
}
