import { useEffect, useState } from "react";
import { ExternalLink, LoaderCircle } from "lucide-react";

import type { AgentDefinition } from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import type { EveAgentDeployment } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";

import { useProviderModels } from "../../lib/runtime";
import { relativeActivityTime } from "../chat/relative-activity-time";
import { verifyEveConnectionWithRetry } from "./agent-connection-model";
import {
  SectionHeading,
  SettingGroup,
  SettingRow,
} from "./agent-detail-sections";

/** Where a Vercel Eve agent runs. Chief keeps it current, so this is mostly read-only. */
export function AgentEveRuntime({
  agent,
  relay,
  connectionStatus,
  onChanged,
  onSetUp,
}: {
  agent: AgentDefinition;
  relay: RelayClient | null;
  connectionStatus: "pending_setup" | "connected" | "degraded";
  onChanged?: () => Promise<void>;
  onSetUp: () => void;
}) {
  const models = useProviderModels("remote");
  const [status, setStatus] = useState<EveAgentDeployment | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [logsUrl, setLogsUrl] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [revision, setRevision] = useState(0);
  const [draftModel, setDraftModel] = useState<string | null>(null);

  useEffect(() => {
    if (!relay) return;
    let active = true;
    void relay
      .vercelEveDeployment(agent.id)
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [agent.id, relay, revision]);

  const redeploy = async (model?: string) => {
    if (!relay) return;
    setDeploying(true);
    setLogsUrl(null);
    setError(null);
    try {
      await relay.redeployVercelEve(agent.id, {
        ...(model ? { model } : undefined),
        onProgress: (progress) => {
          if (progress.inspectorUrl) setLogsUrl(progress.inspectorUrl);
        },
      });
      setRevision((value) => value + 1);
      setDraftModel(null);
      await onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeploying(false);
    }
  };

  const checkConnection = async () => {
    if (!relay) return;
    setChecking(true);
    setError(null);
    try {
      await verifyEveConnectionWithRetry(relay.externalAgents, agent.id);
      await onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setChecking(false);
    }
  };

  const deployment = status?.deployment;
  const selectedModel = draftModel ?? deployment?.model ?? "";
  const changed = Boolean(deployment && selectedModel !== deployment.model);
  const modelLabel = (value: string) =>
    models.models.find((item) => item.value === value)?.label ?? value;

  return (
    <section>
      <SectionHeading
        title="Vercel Eve"
        description={`${agent.name} runs on Vercel. Chief keeps it on the latest version automatically.`}
      />
      <SettingGroup>
        {status && !deployment ? (
          <SettingRow
            title="Set up updates"
            description={`${agent.name} was deployed before Chief managed updates. Deploy it once and it stays current from then on.`}
            control={
              <Button size="sm" onClick={onSetUp}>
                Set up
              </Button>
            }
          />
        ) : null}
        {deployment ? (
          <>
            <SettingRow
              title="Project"
              description={deployment.projectName}
              control={
                deploying ? (
                  <span className="text-muted-foreground flex items-center gap-2 text-xs">
                    <LoaderCircle className="size-3.5 animate-spin" />
                    Deploying
                    {logsUrl ? (
                      <a
                        href={logsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
                      >
                        Logs
                        <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    {deployment.deployedAt
                      ? `Updated ${relativeActivityTime(Date.parse(deployment.deployedAt))}`
                      : "Up to date"}
                  </span>
                )
              }
            />
            <SettingRow
              title="Model"
              description={`The model ${agent.name} runs on.`}
              control={
                <Select
                  value={selectedModel}
                  disabled={!relay || deploying || models.loading}
                  onValueChange={(value) => {
                    if (value) setDraftModel(value);
                  }}
                >
                  <SelectTrigger className="h-8 w-52 text-xs">
                    <span className="truncate">
                      {modelLabel(selectedModel)}
                    </span>
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {models.models.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
          </>
        ) : null}
        {error || status?.issue ? (
          <SettingRow
            title="Needs attention"
            description={
              <span className="text-destructive">{error ?? status?.issue}</span>
            }
            control={
              deployment ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={deploying}
                  onClick={() => void redeploy()}
                >
                  Retry
                </Button>
              ) : null
            }
          />
        ) : null}
        {connectionStatus !== "connected" ? (
          <SettingRow
            title="Connection"
            description={
              connectionStatus === "pending_setup"
                ? "Messaging isn't connected to this deployment yet."
                : "Chief can't reach this deployment right now."
            }
            control={
              <Button
                size="sm"
                variant="outline"
                disabled={!relay || checking}
                onClick={() => void checkConnection()}
              >
                {checking ? "Checking…" : "Check again"}
              </Button>
            }
          />
        ) : null}
        {changed ? (
          <div className="flex items-center justify-end gap-2 px-4 py-3">
            <Button
              size="sm"
              variant="ghost"
              disabled={deploying}
              onClick={() => setDraftModel(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!relay || deploying}
              onClick={() => void redeploy(selectedModel)}
            >
              {deploying ? "Redeploying…" : "Redeploy"}
            </Button>
          </div>
        ) : null}
      </SettingGroup>
    </section>
  );
}
