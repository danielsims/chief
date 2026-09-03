import type {
  AgentDefinition,
  EveAgentProvisioningProgress,
  EveAgentProvisioningResult,
} from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import { Button } from "@chief/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";

import type { DestinationCatalog } from "./agent-eve-deployment-run";
import type { EveConnectionPhase } from "./eve-provisioning-dialog";
import { rememberVercelAccessToken } from "../../lib/vercel-eve-runtime";
import {
  VercelConnection,
  VercelDestinationFields,
} from "../vercel-connection";
import { clearEveDeploymentDraft } from "./agent-eve-deployment-draft";
import { destinationCatalogCache } from "./agent-eve-deployment-run";
import {
  EveProvisioningDialog,
  EveProvisioningStatus,
} from "./eve-provisioning-dialog";

export function EveAutoDeployStatus({
  agent,
  deploymentResult,
  error,
  phase,
  progress,
  provisioningOpen,
  resolvedWorkspaceName,
  saving,
  onCancel,
  onDeployed,
  onProvisioningOpen,
  onRetry,
}: {
  agent: AgentDefinition;
  deploymentResult: EveAgentProvisioningResult | null;
  error: string | null;
  phase: EveConnectionPhase;
  progress: EveAgentProvisioningProgress | null;
  provisioningOpen: boolean;
  resolvedWorkspaceName: string;
  saving: boolean;
  onCancel: () => void;
  onDeployed?: () => Promise<void>;
  onProvisioningOpen: (open: boolean) => void;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-5">
      <EveProvisioningStatus
        agentName={agent.name}
        workspaceName={resolvedWorkspaceName}
        phase={phase}
        progress={progress}
        result={deploymentResult}
        error={saving ? null : error}
      />
      {deploymentResult || error ? (
        <div className="flex justify-end gap-2">
          {error ? (
            <Button variant="outline" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
          <Button
            onClick={() => {
              if (deploymentResult) void onDeployed?.();
              else onCancel();
            }}
          >
            {deploymentResult ? "Done" : "Back"}
          </Button>
        </div>
      ) : null}
      <EveProvisioningDialog
        agentName={agent.name}
        workspaceName={resolvedWorkspaceName}
        open={provisioningOpen && !deploymentResult && !error}
        phase={phase}
        progress={progress}
        result={deploymentResult}
        error={saving ? null : error}
        onClose={() => onProvisioningOpen(false)}
      />
    </div>
  );
}

export function EveDestinationForm({
  agent,
  catalog,
  client,
  connection,
  deploymentResult,
  destinationOnly,
  error,
  loading,
  phase,
  presentation,
  progress,
  projectId,
  projectMode,
  projectName,
  providerModels,
  provisioningOpen,
  resolvedWorkspaceName,
  saving,
  teamId,
  effectiveModel,
  onCancel,
  onCatalogConnected,
  onDeploy,
  onDeployed,
  onDestinationConfirmed,
  onError,
  onMode,
  onModel,
  onProject,
  onProjectName,
  onProvisioningOpen,
  onTeam,
}: {
  agent: AgentDefinition;
  catalog: DestinationCatalog;
  client: RelayClient | null;
  connection: "checking" | "connected" | "missing" | "error";
  deploymentResult: EveAgentProvisioningResult | null;
  destinationOnly: boolean;
  error: string | null;
  loading: boolean;
  phase: EveConnectionPhase;
  presentation: "detail" | "onboarding";
  progress: EveAgentProvisioningProgress | null;
  projectId: string;
  projectMode: "" | "new" | "existing";
  projectName: string;
  providerModels: {
    loading: boolean;
    models: { value: string; label: string }[];
  };
  provisioningOpen: boolean;
  resolvedWorkspaceName: string;
  saving: boolean;
  teamId: string;
  effectiveModel: string;
  onCancel: () => void;
  onCatalogConnected: (catalog: DestinationCatalog) => void;
  onDeploy: () => void;
  onDeployed?: () => Promise<void>;
  onDestinationConfirmed?: () => void;
  onError: (value: string | null) => void;
  onMode: (value: "" | "new" | "existing") => void;
  onModel: (value: string) => void;
  onProject: (value: string) => void;
  onProjectName: (value: string) => void;
  onProvisioningOpen: (open: boolean) => void;
  onTeam: (value: string) => void;
}) {
  return (
    <div
      className={
        presentation === "detail" ? "mt-4 space-y-5 border-t pt-4" : "space-y-5"
      }
    >
      {presentation === "detail" ? (
        <div>
          <p className="text-sm font-medium">
            Deploy {agent.name} to Vercel Eve
          </p>
          <p className="text-muted-foreground mt-1 text-[13px] leading-5">
            Chief will package this agent’s instructions into a Vercel project.
            Messaging and channel activity will continue through this relay.
          </p>
        </div>
      ) : null}

      {connection === "checking" ? (
        <p className="text-muted-foreground text-[13px]">Checking Vercel…</p>
      ) : connection === "error" ? null : (
        <VercelConnection
          connected={connection === "connected"}
          credentialKind="account-access-token"
          presentation="plain"
          expanded={presentation === "onboarding"}
          onCancel={() => {
            clearEveDeploymentDraft(agent.id);
            onCancel();
          }}
          onConnect={async (token) => {
            if (!client)
              throw new Error("Chief is still connecting to this workspace.");
            const next = await client.connectVercel(token);
            rememberVercelAccessToken(client.workspaceId, token);
            if (client.workspaceId) {
              destinationCatalogCache.set(client.workspaceId, next);
            }
            onCatalogConnected(next);
          }}
        />
      )}

      {connection === "connected" ? (
        <>
          <VercelDestinationFields
            loading={loading}
            mode={projectMode}
            projectId={projectId}
            projectName={projectName}
            projects={catalog.projects}
            teamId={teamId}
            teams={catalog.teams}
            onMode={onMode}
            onProject={onProject}
            onProjectName={onProjectName}
            onTeam={onTeam}
          />
          {presentation === "detail" ? (
            <div className="grid gap-1.5">
              <label className="text-[13px] font-medium">Model</label>
              <Select
                value={effectiveModel}
                disabled={providerModels.loading}
                onValueChange={onModel}
              >
                <SelectTrigger className="bg-background h-10">
                  <span className="truncate">
                    {providerModels.loading
                      ? "Loading models…"
                      : (providerModels.models.find(
                          (item) => item.value === effectiveModel,
                        )?.label ?? effectiveModel)}
                  </span>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {providerModels.models.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </>
      ) : null}

      {error ? <p className="text-destructive text-[13px]">{error}</p> : null}
      {connection === "connected" || connection === "error" ? (
        <div className="flex justify-end gap-2">
          {presentation === "detail" ? (
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => {
                clearEveDeploymentDraft(agent.id);
                onCancel();
              }}
            >
              Cancel
            </Button>
          ) : null}
          <Button
            disabled={!client || connection !== "connected" || saving}
            onClick={() => {
              if (destinationOnly) {
                if (!teamId)
                  return onError("Choose the Vercel team to deploy to.");
                if (!projectMode)
                  return onError(
                    "Choose whether to create or reuse a Vercel project.",
                  );
                if (projectMode === "existing" && !projectId)
                  return onError("Choose the Vercel project to deploy to.");
                if (projectMode === "new" && !projectName.trim())
                  return onError("Enter the Vercel project name to create.");
                onError(null);
                onDestinationConfirmed?.();
                return;
              }
              onDeploy();
            }}
          >
            {destinationOnly
              ? "Continue"
              : saving
                ? "Deploying…"
                : presentation === "onboarding"
                  ? "Create workspace"
                  : "Deploy to Vercel Eve"}
          </Button>
        </div>
      ) : null}
      <EveProvisioningDialog
        agentName={agent.name}
        workspaceName={resolvedWorkspaceName}
        open={provisioningOpen}
        phase={phase}
        progress={progress}
        result={deploymentResult}
        error={saving ? null : error}
        onClose={() => {
          onProvisioningOpen(false);
          if (deploymentResult) void onDeployed?.();
        }}
      />
    </div>
  );
}
