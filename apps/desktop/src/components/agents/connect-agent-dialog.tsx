import { useEffect, useMemo, useState } from "react";

import type {
  AgentPreference,
  EveAgentProvisioningInput,
  EveAgentProvisioningProgress,
  EveAgentProvisioningResult,
  VercelEveDestinationCatalog,
} from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import type { CreateNativeAgentCommand } from "@chief/relay-contracts";
import { agentIdSchema } from "@chief/relay-contracts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";

import type { Provider } from "../../lib/providers";
import type { RelayRuntimeIdentity } from "./agent-connection-model";
import type { AgentIntegrationOption } from "./agent-detail-sections";
import type { Deployment } from "./connect-agent-dialog-panel";
import type { ConnectionResult } from "./connect-agent-dialog-sections";
import type { EveConnectionPhase } from "./eve-provisioning-dialog";
import { PROVIDER_META } from "../../lib/providers";
import { useProviderModels } from "../../lib/runtime";
import {
  chiefChannelConfiguration,
  chiefChannelEnvironment,
  isReservedVercelProjectName,
  nativeProvidersForDeployment,
  preferredVercelProjectName,
  suggestedVercelProjectName,
  verifyEveConnectionWithRetry,
} from "./agent-connection-model";
import { ConnectAgentForm, slug, toggle } from "./connect-agent-dialog-panel";
import { ConnectionSetup } from "./connect-agent-dialog-sections";
import { EveProvisioningDialog } from "./eve-provisioning-dialog";

export function ConnectAgentDialog({
  client,
  integrations,
  onConnected,
  onCreateNative,
  onOpenChange,
  onProvisionEve,
  open,
  listVercelEveDestinations,
  connectVercel,
  relayIdentity,
}: {
  client: RelayClient | null;
  integrations: AgentIntegrationOption[];
  onConnected: () => Promise<void>;
  onCreateNative: (
    input: CreateNativeAgentCommand,
    preference: AgentPreference,
  ) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  onProvisionEve: (
    input: EveAgentProvisioningInput,
    onProgress?: (progress: EveAgentProvisioningProgress) => void,
  ) => Promise<EveAgentProvisioningResult>;
  listVercelEveDestinations: (
    teamId?: string,
  ) => Promise<VercelEveDestinationCatalog>;
  connectVercel: (token: string) => Promise<VercelEveDestinationCatalog>;
  relayIdentity: RelayRuntimeIdentity;
  open: boolean;
}) {
  const [deployment, setDeployment] = useState<Deployment>("chief-cloud");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [provider, setProvider] = useState<Provider>("remote");
  const providerModels = useProviderModels(
    deployment === "vercel-eve" ? "remote" : provider,
  );
  const models = providerModels.models.filter(
    (item) => provider !== "remote" || item.value !== "",
  );
  const [model, setModel] = useState("deepseek/deepseek-v4-flash");
  const [selectedIntegrations, setSelectedIntegrations] = useState<string[]>(
    [],
  );
  const [vercelCatalog, setVercelCatalog] =
    useState<VercelEveDestinationCatalog>({ teams: [], projects: [] });
  const [vercelLoading, setVercelLoading] = useState(false);
  const [vercelConnectionStatus, setVercelConnectionStatus] = useState<
    "checking" | "connected" | "missing"
  >("checking");
  const [vercelTeamId, setVercelTeamId] = useState("");
  const [vercelProjectMode, setVercelProjectMode] = useState<
    "" | "new" | "existing"
  >("");
  const [vercelProjectId, setVercelProjectId] = useState("");
  const [vercelProjectNameOverride, setVercelProjectNameOverride] = useState<
    string | null
  >(null);
  const [result, setResult] = useState<ConnectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [provisioningProgress, setProvisioningProgress] =
    useState<EveAgentProvisioningProgress | null>(null);
  const [provisioningResult, setProvisioningResult] =
    useState<EveAgentProvisioningResult | null>(null);
  const [provisioningPhase, setProvisioningPhase] =
    useState<EveConnectionPhase>("validating");
  const [copied, setCopied] = useState(false);
  const agentId = useMemo(() => slug(name), [name]);
  const vercelProjectName =
    vercelProjectNameOverride ??
    suggestedVercelProjectName(
      name.trim() || "agent",
      vercelCatalog.projects.map((project) => project.name),
      client?.workspaceId ?? "",
    );
  const effectiveModel = models.some((item) => item.value === model)
    ? model
    : (models[0]?.value ?? model);
  const availableProviders: readonly Provider[] =
    deployment === "vercel-eve" ? [] : nativeProvidersForDeployment(deployment);
  const selectedProviderMeta = PROVIDER_META[provider];
  const SelectedProviderIcon = selectedProviderMeta.Icon;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listVercelEveDestinations()
      .then((catalog) => {
        if (!cancelled) {
          setVercelCatalog(catalog);
          setVercelConnectionStatus("connected");
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          const message =
            caught instanceof Error
              ? caught.message
              : "Chief could not load your Vercel teams.";
          if (/connect vercel/i.test(message)) {
            setVercelConnectionStatus("missing");
          } else {
            setError(message);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setVercelLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listVercelEveDestinations, open]);

  useEffect(() => {
    if (!open || deployment !== "vercel-eve" || !vercelTeamId) return;
    let cancelled = false;
    void listVercelEveDestinations(vercelTeamId)
      .then((catalog) => {
        if (!cancelled) setVercelCatalog(catalog);
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
        if (!cancelled) setVercelLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deployment, listVercelEveDestinations, open, vercelTeamId]);

  const close = () => {
    setResult(null);
    setError(null);
    setCopied(false);
    setProvisioningProgress(null);
    setProvisioningResult(null);
    setProvisioningPhase("validating");
    setDeployment("chief-cloud");
    setVercelConnectionStatus("checking");
    setName("");
    setDescription("");
    setInstructions("");
    setSelectedIntegrations([]);
    setVercelTeamId("");
    setVercelProjectMode("");
    setVercelProjectId("");
    setVercelProjectNameOverride(null);
    onOpenChange(false);
  };
  const create = async () => {
    if (
      !agentId ||
      !name.trim() ||
      !description.trim() ||
      !instructions.trim()
    ) {
      setError(
        "Add a name, description, and instructions before creating the agent.",
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (deployment === "vercel-eve") {
        if (!client)
          throw new Error("Chief is still connecting to this workspace.");
        if (!vercelTeamId)
          throw new Error("Choose the Vercel team to deploy to.");
        if (!vercelProjectMode)
          throw new Error(
            "Choose whether to create or reuse a Vercel project.",
          );
        const selectedProject = vercelCatalog.projects.find(
          (project) => project.id === vercelProjectId,
        );
        let projectName =
          vercelProjectMode === "existing"
            ? selectedProject?.name
            : slug(vercelProjectName);
        if (vercelProjectMode !== "existing") {
          projectName = preferredVercelProjectName(
            name.trim() || "agent",
            projectName ?? "",
          );
          setVercelProjectNameOverride(projectName);
        }
        if (!projectName) {
          throw new Error(
            vercelProjectMode === "existing"
              ? "Choose the Vercel project to deploy to."
              : "Enter the name of the Vercel project to create.",
          );
        }
        if (isReservedVercelProjectName(projectName)) {
          throw new Error(
            `"${projectName}" is reserved for Chief's own Vercel project. Deploy this Eve agent under a different name.`,
          );
        }
        const endpoint = `https://${projectName}.vercel.app/channels/chief/messages`;
        let registered = false;
        try {
          const registration = await client.externalAgents.register({
            agentId: agentIdSchema.parse(agentId),
            name: name.trim(),
            role: "External agent",
            description: description.trim(),
            instructions: instructions.trim(),
            endpoint,
          });
          registered = true;
          const connection = { agentId, ...registration.channel };
          setResult(connection);
          const deployed = await onProvisionEve(
            {
              teamId: vercelTeamId,
              project:
                vercelProjectMode === "existing" && selectedProject
                  ? {
                      kind: "existing",
                      projectId: selectedProject.id,
                      projectName: selectedProject.name,
                    }
                  : { kind: "new", projectName },
              agent: {
                id: agentId,
                name: name.trim(),
                role: "External agent",
                description: description.trim(),
                instructions: instructions.trim(),
                model: effectiveModel,
              },
              environment: chiefChannelEnvironment(connection),
            },
            (next) => {
              setProvisioningProgress((current) => ({
                ...next,
                logs: next.logs ?? current?.logs,
              }));
              setProvisioningPhase(next.phase);
            },
          );
          setProvisioningPhase("verifying");
          await verifyEveConnectionWithRetry(client.externalAgents, agentId);
          setProvisioningResult(deployed);
          return;
        } catch (caught) {
          if (registered) {
            await client.externalAgents
              .disconnect(agentId)
              .catch(() => undefined);
            setResult(null);
          }
          throw caught;
        }
      }
      await onCreateNative(
        {
          agentId,
          name: name.trim(),
          role: "Workspace agent",
          description: description.trim(),
          instructions: instructions.trim(),
        },
        {
          agentId,
          enabled: true,
          deploymentTarget: deployment === "chief-cloud" ? "cloud" : "desktop",
          driver: provider,
          model: effectiveModel || undefined,
          integrations: selectedIntegrations,
        },
      );
      close();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Chief could not create this agent.",
      );
    } finally {
      setSaving(false);
    }
  };
  const configuration = result ? chiefChannelConfiguration(result) : "";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && close()}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>{result ? "Finish setup" : "New agent"}</DialogTitle>
          <DialogDescription>
            {result
              ? "Chief could not finish the Vercel setup automatically. Use the manual fallback below."
              : "Create an agent in Chief or connect the same identity to Vercel Eve."}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <ConnectionSetup
            client={client}
            configuration={configuration}
            copied={copied}
            error={error}
            result={result}
            saving={saving}
            onClose={close}
            onConnected={onConnected}
            onCopied={setCopied}
            onError={setError}
            onSaving={setSaving}
          />
        ) : (
          <ConnectAgentForm
            name={name}
            description={description}
            instructions={instructions}
            deployment={deployment}
            provider={provider}
            models={models}
            effectiveModel={effectiveModel}
            providerModelsLoading={providerModels.loading}
            availableProviders={availableProviders}
            selectedProviderMeta={selectedProviderMeta}
            SelectedProviderIcon={SelectedProviderIcon}
            integrations={integrations}
            selectedIntegrations={selectedIntegrations}
            vercelCatalog={vercelCatalog}
            vercelLoading={vercelLoading}
            vercelConnectionStatus={vercelConnectionStatus}
            vercelTeamId={vercelTeamId}
            vercelProjectMode={vercelProjectMode}
            vercelProjectId={vercelProjectId}
            vercelProjectName={vercelProjectName}
            error={error}
            saving={saving}
            agentId={agentId}
            relayIdentity={relayIdentity}
            onNameChange={setName}
            onDescriptionChange={setDescription}
            onInstructionsChange={setInstructions}
            onDeploymentChange={(value) => {
              if (value === "vercel-eve") setError(null);
              setDeployment(value);
              if (value === "on-device" && provider === "remote") {
                setProvider("opencode");
              }
            }}
            onProviderChange={setProvider}
            onModelChange={setModel}
            onToggleIntegration={(id) =>
              toggle(id, selectedIntegrations, setSelectedIntegrations)
            }
            onConnectVercel={async (token) => {
              const catalog = await connectVercel(token);
              setVercelCatalog(catalog);
              setVercelConnectionStatus("connected");
            }}
            onTeamChange={(teamId) => {
              setVercelLoading(true);
              setVercelProjectId("");
              setVercelTeamId(teamId);
            }}
            onProjectModeChange={setVercelProjectMode}
            onProjectChange={setVercelProjectId}
            onProjectNameChange={setVercelProjectNameOverride}
            onCreate={() => void create()}
          />
        )}
      </DialogContent>
      <EveProvisioningDialog
        agentName={name.trim() || "agent"}
        workspaceName={name.trim() || "this workspace"}
        open={
          deployment === "vercel-eve" &&
          (saving ||
            provisioningResult !== null ||
            (Boolean(error) && provisioningProgress !== null))
        }
        phase={provisioningPhase}
        progress={provisioningProgress}
        result={provisioningResult}
        error={saving ? null : error}
        onClose={() => {
          if (provisioningResult) {
            close();
            void onConnected();
            return;
          }
          setProvisioningProgress(null);
        }}
      />
    </Dialog>
  );
}
