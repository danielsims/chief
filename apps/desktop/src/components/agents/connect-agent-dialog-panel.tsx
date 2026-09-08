import { Vercel } from "@lobehub/icons";
import { Laptop, Server } from "lucide-react";

import type { VercelEveDestinationCatalog } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { DialogFooter } from "@chief/ui/components/dialog";
import { Input } from "@chief/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";

import type { Provider } from "../../lib/providers";
import type { RelayRuntimeIdentity } from "./agent-connection-model";
import type { AgentIntegrationOption } from "./agent-detail-sections";
import { PROVIDER_META } from "../../lib/providers";
import { ChiefMark } from "../chief-mark";
import {
  VercelConnection,
  VercelDestinationFields,
} from "../vercel-connection";
import { ChoiceGrid, Field, Section } from "./connect-agent-dialog-sections";

export type Deployment = "chief-cloud" | "on-device" | "vercel-eve";

export function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
}

export function toggle(
  id: string,
  values: string[],
  setValues: (values: string[]) => void,
) {
  setValues(
    values.includes(id)
      ? values.filter((value) => value !== id)
      : [...values, id],
  );
}

export function isCreationProvider(value: string): value is Provider {
  return ["remote", "opencode", "claude", "codex"].includes(value);
}

export function isDeployment(value: string): value is Deployment {
  return ["chief-cloud", "vercel-eve", "on-device"].includes(value);
}

export function ConnectAgentForm({
  name,
  description,
  instructions,
  deployment,
  provider,
  models,
  effectiveModel,
  providerModelsLoading,
  availableProviders,
  selectedProviderMeta,
  SelectedProviderIcon,
  integrations,
  selectedIntegrations,
  vercelCatalog,
  vercelLoading,
  vercelConnectionStatus,
  vercelTeamId,
  vercelProjectMode,
  vercelProjectId,
  vercelProjectName,
  error,
  saving,
  agentId,
  relayIdentity,
  onNameChange,
  onDescriptionChange,
  onInstructionsChange,
  onDeploymentChange,
  onProviderChange,
  onModelChange,
  onToggleIntegration,
  onConnectVercel,
  onTeamChange,
  onProjectModeChange,
  onProjectChange,
  onProjectNameChange,
  onCreate,
}: {
  name: string;
  description: string;
  instructions: string;
  deployment: Deployment;
  provider: Provider;
  models: { value: string; label: string }[];
  effectiveModel: string;
  providerModelsLoading: boolean;
  availableProviders: readonly Provider[];
  selectedProviderMeta: (typeof PROVIDER_META)[Provider];
  SelectedProviderIcon: (typeof PROVIDER_META)[Provider]["Icon"];
  integrations: AgentIntegrationOption[];
  selectedIntegrations: string[];
  vercelCatalog: VercelEveDestinationCatalog;
  vercelLoading: boolean;
  vercelConnectionStatus: "checking" | "connected" | "missing";
  vercelTeamId: string;
  vercelProjectMode: "" | "new" | "existing";
  vercelProjectId: string;
  vercelProjectName: string;
  error: string | null;
  saving: boolean;
  agentId: string;
  relayIdentity: RelayRuntimeIdentity;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onInstructionsChange: (value: string) => void;
  onDeploymentChange: (value: Deployment) => void;
  onProviderChange: (value: Provider) => void;
  onModelChange: (value: string) => void;
  onToggleIntegration: (id: string) => void;
  onConnectVercel: (token: string) => Promise<void>;
  onTeamChange: (teamId: string) => void;
  onProjectModeChange: (value: "" | "new" | "existing") => void;
  onProjectChange: (value: string) => void;
  onProjectNameChange: (value: string) => void;
  onCreate: () => void;
}) {
  return (
    <>
      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
        <Section
          title="Identity"
          description="Define who this agent is and how it should work."
        >
          <Field label="Agent name">
            <Input
              className="bg-background"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Researcher"
            />
          </Field>
          <Field label="Description">
            <Input
              className="bg-background"
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder="Researches markets and returns source-backed findings."
            />
          </Field>
          <Field label="Instructions">
            <textarea
              className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-36 w-full resize-y rounded-lg border px-3 py-2.5 text-sm leading-6 outline-none focus-visible:ring-1"
              value={instructions}
              onChange={(event) => onInstructionsChange(event.target.value)}
              placeholder={
                "# Identity\n\nDescribe this agent's role, workflow, tool use, and boundaries."
              }
            />
          </Field>
        </Section>
        <Section title="Runtime" description="Choose where this agent runs.">
          <Field label="Runs on">
            <Select
              value={deployment}
              onValueChange={(value) => {
                if (!isDeployment(value)) return;
                onDeploymentChange(value);
              }}
            >
              <SelectTrigger className="bg-background h-10">
                <RuntimeOption
                  deployment={deployment}
                  relayIdentity={relayIdentity}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chief-cloud">
                  <RuntimeOption
                    deployment="chief-cloud"
                    relayIdentity={relayIdentity}
                  />
                </SelectItem>
                <SelectItem value="vercel-eve">
                  <RuntimeOption
                    deployment="vercel-eve"
                    relayIdentity={relayIdentity}
                  />
                </SelectItem>
                <SelectItem value="on-device">
                  <RuntimeOption
                    deployment="on-device"
                    relayIdentity={relayIdentity}
                  />
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {deployment !== "vercel-eve" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Agent provider">
                <Select
                  value={provider}
                  onValueChange={(value) => {
                    if (isCreationProvider(value)) onProviderChange(value);
                  }}
                >
                  <SelectTrigger className="bg-background h-10">
                    <span className="flex items-center gap-2">
                      <SelectedProviderIcon size={15} />
                      {selectedProviderMeta.label}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {availableProviders.map((id) => {
                      const ProviderIcon = PROVIDER_META[id].Icon;
                      return (
                        <SelectItem key={id} value={id}>
                          <span className="flex items-center gap-2">
                            <ProviderIcon size={15} />
                            {PROVIDER_META[id].label}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Model">
                <Select
                  value={effectiveModel}
                  disabled={providerModelsLoading}
                  onValueChange={onModelChange}
                >
                  <SelectTrigger className="bg-background h-10">
                    <span className="truncate">
                      {providerModelsLoading
                        ? "Loading models…"
                        : (models.find((item) => item.value === effectiveModel)
                            ?.label ?? effectiveModel)}
                    </span>
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {models.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          ) : (
            <>
              <VercelConnection
                connected={vercelConnectionStatus === "connected"}
                credentialKind="account-access-token"
                disabled={vercelConnectionStatus === "checking"}
                onConnect={onConnectVercel}
              />
              {vercelConnectionStatus === "connected" ? (
                <VercelDestinationFields
                  loading={vercelLoading}
                  mode={vercelProjectMode}
                  projectId={vercelProjectId}
                  projectName={vercelProjectName}
                  projects={vercelCatalog.projects}
                  teamId={vercelTeamId}
                  teams={vercelCatalog.teams}
                  onMode={onProjectModeChange}
                  onProject={onProjectChange}
                  onProjectName={onProjectNameChange}
                  onTeam={onTeamChange}
                />
              ) : null}
              {vercelConnectionStatus === "connected" ? (
                <Field label="Model">
                  <Select
                    value={effectiveModel}
                    disabled={providerModelsLoading}
                    onValueChange={onModelChange}
                  >
                    <SelectTrigger className="bg-background h-10">
                      <span className="truncate">
                        {providerModelsLoading
                          ? "Loading models…"
                          : (models.find(
                              (item) => item.value === effectiveModel,
                            )?.label ?? effectiveModel)}
                      </span>
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {models.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
            </>
          )}
        </Section>
        {deployment !== "vercel-eve" && integrations.length > 0 ? (
          <Section
            title="Connections"
            description="Give this agent access to connected services."
          >
            <ChoiceGrid
              items={integrations.map((integration) => ({
                id: integration.provider,
                label: integration.displayName,
                selected: selectedIntegrations.includes(integration.provider),
              }))}
              onToggle={onToggleIntegration}
            />
          </Section>
        ) : null}
        {error ? <p className="text-destructive text-[13px]">{error}</p> : null}
      </div>
      <DialogFooter className="border-t px-6 py-4">
        <Button
          className="w-full"
          disabled={saving || !agentId}
          onClick={onCreate}
        >
          {saving ? "Creating…" : "Create agent"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function RuntimeOption({
  deployment,
  relayIdentity,
}: {
  deployment: Deployment;
  relayIdentity: RelayRuntimeIdentity;
}) {
  if (deployment === "chief-cloud") {
    if (relayIdentity.kind === "self-hosted") {
      return (
        <span className="flex min-w-0 items-center gap-2">
          <Server className="size-4 shrink-0" />
          <span className="truncate">{relayIdentity.name}</span>
          <span className="text-muted-foreground shrink-0">- Self hosted</span>
        </span>
      );
    }
    return (
      <span className="flex items-center gap-2">
        <ChiefMark className="size-4" />
        Chief relay
      </span>
    );
  }
  if (deployment === "vercel-eve") {
    return (
      <span className="flex items-center gap-2">
        <Vercel size={16} />
        Vercel Eve
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <Laptop size={16} />
      On device
    </span>
  );
}
