import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentDefinition,
  EveAgentProvisioningProgress,
  EveAgentProvisioningResult,
} from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";

import type { EveConnectionPhase } from "./eve-provisioning-dialog";
import { useProviderModels } from "../../lib/runtime";
import {
  eveDeploymentInstructions,
  preferredVercelProjectName,
  suggestedVercelProjectName,
  verifyEveConnectionWithRetry,
} from "./agent-connection-model";
import {
  clearEveDeploymentDraft,
  readEveDeploymentDraft,
  readEveProvisioningDraft,
  writeEveDeploymentDraft,
  writeEveProvisioningDraft,
} from "./agent-eve-deployment-draft";
import {
  EveAutoDeployStatus,
  EveDestinationForm,
} from "./agent-eve-deployment-form";
import {
  destinationCatalogCache,
  runEveAgentDeployment,
} from "./agent-eve-deployment-run";

export { hasEveDeploymentDraft } from "./agent-eve-deployment-draft";

function firstNonempty(...values: (string | null | undefined)[]) {
  return values.find((value) => (value ?? "").length > 0) ?? "";
}

export function AgentEveDeploymentPanel({
  agent,
  client,
  initialCatalog,
  initialDestination,
  presentation = "detail",
  destinationOnly = false,
  autoDeploy = false,
  selectedApps,
  workspaceName,
  workspaceId,
  onCancel,
  onDestinationConfirmed,
  onDeployed,
}: {
  agent: AgentDefinition;
  client: RelayClient | null;
  initialCatalog?: Awaited<ReturnType<RelayClient["listVercelDestinations"]>>;
  initialDestination?: {
    teamId: string;
    projectMode: "new" | "existing";
    projectId: string;
    projectName: string;
  };
  presentation?: "detail" | "onboarding";
  destinationOnly?: boolean;
  autoDeploy?: boolean;
  selectedApps?: readonly string[];
  workspaceName?: string;
  workspaceId?: string;
  onCancel: () => void;
  onDestinationConfirmed?: () => void;
  onDeployed?: () => Promise<void>;
}) {
  const persistedDraft = useMemo(
    () => readEveDeploymentDraft(agent.id),
    [agent.id],
  );
  const persistedProvisioning = useMemo(
    () => readEveProvisioningDraft(agent.id),
    [agent.id],
  );
  const cachedCatalog =
    initialCatalog ??
    (client?.workspaceId
      ? destinationCatalogCache.get(client.workspaceId)
      : undefined);
  const resolvedWorkspaceName = firstNonempty(
    workspaceName?.trim(),
    agent.name,
  );
  const resolvedWorkspaceId = firstNonempty(workspaceId, client?.workspaceId);
  const [connection, setConnection] = useState<
    "checking" | "connected" | "missing" | "error"
  >(cachedCatalog ? "connected" : "checking");
  const [catalog, setCatalog] = useState(
    cachedCatalog ?? { teams: [], projects: [] },
  );
  const [loading, setLoading] = useState(!cachedCatalog);
  const [teamId, setTeamId] = useState(
    firstNonempty(initialDestination?.teamId, persistedDraft?.teamId),
  );
  const [projectMode, setProjectMode] = useState<"" | "new" | "existing">(
    initialDestination?.projectMode ??
      persistedDraft?.projectMode ??
      (presentation === "onboarding" ? "new" : ""),
  );
  const [projectId, setProjectId] = useState(
    firstNonempty(initialDestination?.projectId, persistedDraft?.projectId),
  );
  const [projectNameOverride, setProjectNameOverride] = useState(
    preferredVercelProjectName(
      resolvedWorkspaceName,
      firstNonempty(
        initialDestination?.projectName,
        persistedDraft?.projectNameOverride,
      ),
    ),
  );
  const [model, setModel] = useState(
    persistedDraft?.model ?? "deepseek/deepseek-v4-flash",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(
    persistedProvisioning?.error ?? null,
  );
  const [phase, setPhase] = useState<EveConnectionPhase>(
    persistedProvisioning?.phase ?? "validating",
  );
  const [progress, setProgress] = useState<EveAgentProvisioningProgress | null>(
    persistedProvisioning?.progress ?? null,
  );
  const [deploymentResult, setDeploymentResult] =
    useState<EveAgentProvisioningResult | null>(
      persistedProvisioning?.result ?? null,
    );
  const [provisioningOpen, setProvisioningOpen] = useState(
    autoDeploy || persistedProvisioning?.open === true,
  );
  const autoDeployStarted = useRef(
    persistedProvisioning?.result != null ||
      persistedProvisioning?.error != null,
  );
  const providerModels = useProviderModels("remote");
  const projectName = useMemo(
    () =>
      projectNameOverride ||
      suggestedVercelProjectName(
        resolvedWorkspaceName,
        catalog.projects.map((project) => project.name),
        resolvedWorkspaceId,
      ),
    [
      catalog.projects,
      projectNameOverride,
      resolvedWorkspaceId,
      resolvedWorkspaceName,
    ],
  );
  const effectiveModel = providerModels.models.some(
    (item) => item.value === model,
  )
    ? model
    : (providerModels.models[0]?.value ?? model);
  const deploymentInstructions = eveDeploymentInstructions(agent);

  useEffect(() => {
    writeEveDeploymentDraft(agent.id, {
      model,
      projectId,
      projectMode,
      projectNameOverride,
      teamId,
    });
  }, [agent.id, model, projectId, projectMode, projectNameOverride, teamId]);

  useEffect(() => {
    writeEveProvisioningDraft(agent.id, {
      open: provisioningOpen,
      phase,
      progress: progress
        ? (({ logs: _logs, ...rest }) => rest)(progress)
        : null,
      error: saving ? null : error,
      result: deploymentResult,
    });
  }, [
    agent.id,
    deploymentResult,
    error,
    phase,
    progress,
    provisioningOpen,
    saving,
  ]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void client
      .listVercelDestinations()
      .then((next) => {
        if (cancelled) return;
        if (client.workspaceId) {
          destinationCatalogCache.set(client.workspaceId, next);
        }
        setCatalog(next);
        setConnection("connected");
        setTeamId((current) => firstNonempty(current, next.teams[0]?.id));
        if (presentation === "onboarding") {
          setProjectMode((current) => (current === "" ? "new" : current));
        }
        setProjectNameOverride((current) =>
          preferredVercelProjectName(resolvedWorkspaceName, current),
        );
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const message =
          caught instanceof Error
            ? caught.message
            : "Chief could not load your Vercel connection.";
        if (/connect vercel/i.test(message)) setConnection("missing");
        else {
          setConnection("error");
          setError(message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, presentation, resolvedWorkspaceId, resolvedWorkspaceName]);

  useEffect(() => {
    if (!client || connection !== "connected" || !teamId) return;
    let cancelled = false;
    void client
      .listVercelDestinations(teamId)
      .then((next) => {
        if (!cancelled) {
          setCatalog(next);
          setProjectNameOverride((current) =>
            preferredVercelProjectName(resolvedWorkspaceName, current),
          );
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Chief could not load the selected team's projects.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, connection, resolvedWorkspaceName, teamId]);

  const deploy = useCallback(async () => {
    if (!client) return;
    if (!teamId) return setError("Choose the Vercel team to deploy to.");
    if (!projectMode)
      return setError("Choose whether to create or reuse a Vercel project.");

    setSaving(true);
    setError(null);
    setProgress(null);
    setDeploymentResult(null);
    setPhase("validating");
    setProvisioningOpen(true);
    try {
      const result = await runEveAgentDeployment({
        agent,
        client,
        deploymentInstructions,
        effectiveModel,
        projectId,
        projectMode,
        projectName,
        resolvedWorkspaceName,
        teamId,
        onCatalog: setCatalog,
        onProgress: (next) => {
          setProgress((current) => ({
            ...next,
            logs: next.logs ?? current?.logs,
          }));
          setPhase(next.phase);
        },
        onProjectName: setProjectNameOverride,
      });
      setProgress({ phase: "checking", ...result });
      setPhase("verifying");
      await verifyEveConnectionWithRetry(
        client.externalAgents,
        agent.id,
        selectedApps,
      );
      clearEveDeploymentDraft(agent.id);
      setDeploymentResult(result);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Chief could not move this agent to Vercel Eve.",
      );
    } finally {
      setSaving(false);
    }
  }, [
    agent,
    client,
    deploymentInstructions,
    effectiveModel,
    projectId,
    projectMode,
    projectName,
    resolvedWorkspaceName,
    selectedApps,
    setCatalog,
    teamId,
  ]);

  useEffect(() => {
    if (
      !autoDeploy ||
      autoDeployStarted.current ||
      connection !== "connected" ||
      loading ||
      deploymentResult
    )
      return;
    autoDeployStarted.current = true;
    void deploy();
  }, [autoDeploy, connection, deploy, deploymentResult, loading]);

  if (autoDeploy) {
    return (
      <EveAutoDeployStatus
        agent={agent}
        deploymentResult={deploymentResult}
        error={error}
        phase={phase}
        progress={progress}
        provisioningOpen={provisioningOpen}
        resolvedWorkspaceName={resolvedWorkspaceName}
        saving={saving}
        onCancel={onCancel}
        onDeployed={onDeployed}
        onProvisioningOpen={setProvisioningOpen}
        onRetry={() => {
          autoDeployStarted.current = false;
          void deploy();
        }}
      />
    );
  }

  return (
    <EveDestinationForm
      agent={agent}
      catalog={catalog}
      client={client}
      connection={connection}
      deploymentResult={deploymentResult}
      destinationOnly={destinationOnly}
      error={error}
      loading={loading}
      phase={phase}
      presentation={presentation}
      progress={progress}
      projectId={projectId}
      projectMode={projectMode}
      projectName={projectName}
      providerModels={providerModels}
      provisioningOpen={provisioningOpen}
      resolvedWorkspaceName={resolvedWorkspaceName}
      saving={saving}
      teamId={teamId}
      effectiveModel={effectiveModel}
      onCancel={onCancel}
      onCatalogConnected={(next) => {
        setCatalog(next);
        setLoading(false);
        setConnection("connected");
      }}
      onDeploy={() => void deploy()}
      onDeployed={onDeployed}
      onDestinationConfirmed={onDestinationConfirmed}
      onError={setError}
      onMode={setProjectMode}
      onModel={setModel}
      onProject={setProjectId}
      onProjectName={setProjectNameOverride}
      onProvisioningOpen={setProvisioningOpen}
      onTeam={(value) => {
        setLoading(true);
        setProjectId("");
        setTeamId(value);
      }}
    />
  );
}
