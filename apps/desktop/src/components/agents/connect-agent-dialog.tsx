import { useEffect, useMemo, useState } from "react";
import { Vercel } from "@lobehub/icons";
import { Laptop, Server } from "lucide-react";

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
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
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
import type { ConnectionResult } from "./connect-agent-dialog-sections";
import type { EveConnectionPhase } from "./eve-provisioning-dialog";
import { PROVIDER_META } from "../../lib/providers";
import { useProviderModels } from "../../lib/runtime";
import { ChiefMark } from "../chief-mark";
import {
  VercelConnection,
  VercelDestinationFields,
} from "../vercel-connection";
import {
  chiefChannelConfiguration,
  chiefChannelEnvironment,
  nativeProvidersForDeployment,
  suggestedVercelProjectName,
  verifyEveConnectionWithRetry,
} from "./agent-connection-model";
import {
  ChoiceGrid,
  ConnectionSetup,
  Field,
  Section,
} from "./connect-agent-dialog-sections";
import { EveProvisioningDialog } from "./eve-provisioning-dialog";

type Deployment = "chief-cloud" | "on-device" | "vercel-eve";

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
  const [vercelProjectCollisionSuffix, setVercelProjectCollisionSuffix] =
    useState(randomProjectSuffix);
  const [result, setResult] = useState<ConnectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [provisioningProgress, setProvisioningProgress] =
    useState<EveAgentProvisioningProgress | null>(null);
  const [provisioningPhase, setProvisioningPhase] =
    useState<EveConnectionPhase>("validating");
  const [copied, setCopied] = useState(false);
  const agentId = useMemo(() => slug(name), [name]);
  const vercelProjectName =
    vercelProjectNameOverride ??
    suggestedVercelProjectName(
      name,
      vercelCatalog.projects.map((project) => project.name),
      vercelProjectCollisionSuffix,
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
    setVercelProjectCollisionSuffix(randomProjectSuffix());
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
        const projectName =
          vercelProjectMode === "existing"
            ? selectedProject?.name
            : slug(vercelProjectName);
        if (!projectName) {
          throw new Error(
            vercelProjectMode === "existing"
              ? "Choose the Vercel project to deploy to."
              : "Enter the name of the Vercel project to create.",
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
          await onProvisionEve(
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
                name: name.trim(),
                description: description.trim(),
                instructions: instructions.trim(),
                model: effectiveModel,
              },
              environment: chiefChannelEnvironment(connection),
            },
            (next) => {
              setProvisioningProgress(next);
              setProvisioningPhase(next.phase);
            },
          );
          setProvisioningPhase("verifying");
          await verifyEveConnectionWithRetry(client.externalAgents, agentId);
          close();
          await onConnected();
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
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Researcher"
                  />
                </Field>
                <Field label="Description">
                  <Input
                    className="bg-background"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Researches markets and returns source-backed findings."
                  />
                </Field>
                <Field label="Instructions">
                  <textarea
                    className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring min-h-36 w-full resize-y rounded-lg border px-3 py-2.5 text-sm leading-6 outline-none focus-visible:ring-1"
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    placeholder={
                      "# Identity\n\nDescribe this agent's role, workflow, tool use, and boundaries."
                    }
                  />
                </Field>
              </Section>
              <Section
                title="Runtime"
                description="Choose where this agent runs."
              >
                <Field label="Runs on">
                  <Select
                    value={deployment}
                    onValueChange={(value) => {
                      if (!isDeployment(value)) return;
                      if (value === "vercel-eve") {
                        setError(null);
                      }
                      setDeployment(value);
                      if (value === "on-device" && provider === "remote") {
                        setProvider("opencode");
                      }
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
                          if (isCreationProvider(value)) setProvider(value);
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
                        disabled={providerModels.loading}
                        onValueChange={setModel}
                      >
                        <SelectTrigger className="bg-background h-10">
                          <span className="truncate">
                            {providerModels.loading
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
                  </div>
                ) : (
                  <>
                    <VercelConnection
                      connected={vercelConnectionStatus === "connected"}
                      credentialKind="account-access-token"
                      disabled={vercelConnectionStatus === "checking"}
                      onConnect={async (token) => {
                        const catalog = await connectVercel(token);
                        setVercelCatalog(catalog);
                        setVercelConnectionStatus("connected");
                      }}
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
                        onMode={setVercelProjectMode}
                        onProject={setVercelProjectId}
                        onProjectName={setVercelProjectNameOverride}
                        onTeam={(teamId) => {
                          setVercelLoading(true);
                          setVercelProjectId("");
                          setVercelTeamId(teamId);
                        }}
                      />
                    ) : null}
                    {vercelConnectionStatus === "connected" ? (
                      <Field label="Model">
                        <Select
                          value={effectiveModel}
                          disabled={providerModels.loading}
                          onValueChange={setModel}
                        >
                          <SelectTrigger className="bg-background h-10">
                            <span className="truncate">
                              {providerModels.loading
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
                      selected: selectedIntegrations.includes(
                        integration.provider,
                      ),
                    }))}
                    onToggle={(id) =>
                      toggle(id, selectedIntegrations, setSelectedIntegrations)
                    }
                  />
                </Section>
              ) : null}
              {error ? (
                <p className="text-destructive text-[13px]">{error}</p>
              ) : null}
            </div>
            <DialogFooter className="border-t px-6 py-4">
              <Button
                className="w-full"
                disabled={saving || !agentId}
                onClick={() => void create()}
              >
                {saving ? "Creating…" : "Create agent"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
      <EveProvisioningDialog
        agentName={name.trim() || "agent"}
        endpoint={
          vercelProjectMode === "existing"
            ? (vercelCatalog.projects.find(
                (project) => project.id === vercelProjectId,
              )?.name ?? "")
            : vercelProjectName
        }
        open={deployment === "vercel-eve" && saving && result !== null}
        phase={provisioningPhase}
        progress={provisioningProgress}
      />
    </Dialog>
  );
}

function toggle(
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
function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
}

function randomProjectSuffix() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(1_000_000 + ((values.at(0) ?? 0) % 9_000_000));
}

function isCreationProvider(value: string): value is Provider {
  return ["remote", "opencode", "claude", "codex"].includes(value);
}

function isDeployment(value: string): value is Deployment {
  return ["chief-cloud", "vercel-eve", "on-device"].includes(value);
}

function RuntimeOption({
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
