import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Circle,
  FileStack,
  ListChecks,
  MessageSquareText,
} from "lucide-react";

import type { ExecutorArtifactSummary } from "@chief/agent-runtime/artifact-types";
import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import type { AuthOrganization } from "../../lib/auth/better-auth-client";
import { useAuth } from "../../lib/auth/auth-context";
import {
  cachedAuthOrganization,
  listAuthOrganizations,
  parseOrganizationMetadata,
} from "../../lib/auth/better-auth-client";
import { chiefArtifacts } from "../../lib/chief-artifacts";
import { useExecutorArtifacts } from "../../lib/executor-artifacts";
import { INTEGRATION_CATALOG } from "../../lib/integration-catalog";
import { useLocalIntegrationStatus } from "../../lib/local-integration-status";
import { useWorkspaceData } from "../../lib/runtime";
import { GETTING_STARTED_CHANNEL_RELAY_ID } from "../../lib/workspace-channels";
import { ArtifactPreview } from "../artifact-preview";

interface ChecklistItem {
  id: string;
  title: string;
  detail: string;
  complete: boolean;
}

const PROVIDER_BY_DOMAIN = new Map(
  INTEGRATION_CATALOG.flatMap((group) => group.integrations).map(
    (integration) => [integration.domain, integration.provider],
  ),
);

function selectedIntegrationDomains(organization: AuthOrganization | null) {
  const onboarding = parseOrganizationMetadata(organization).onboarding;
  if (!onboarding || typeof onboarding !== "object") return [];
  const domains = new Set<string>();
  for (const section of ["analytics", "ads", "aeo", "engineering"] as const) {
    const value = (onboarding as Record<string, unknown>)[section];
    if (!value || typeof value !== "object") continue;
    const integrations = (value as Record<string, unknown>).integrations;
    if (!Array.isArray(integrations)) continue;
    for (const integration of integrations) {
      if (!integration || typeof integration !== "object") continue;
      const domain = (integration as Record<string, unknown>).domain;
      if (typeof domain === "string" && domain.trim()) domains.add(domain);
    }
  }
  return [...domains];
}

function CanvasArtifact({
  artifact,
  onContinue,
}: {
  artifact: ExecutorArtifactSummary;
  onContinue: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onContinue}
      className="bg-card hover:border-foreground/20 group overflow-hidden rounded-xl border text-left transition-colors"
    >
      <span className="bg-muted/35 relative block aspect-[16/9] overflow-hidden border-b">
        <ArtifactPreview artifact={artifact} />
      </span>
      <span className="flex items-center gap-3 p-3.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">
            {artifact.title}
          </span>
          <span className="text-muted-foreground mt-1 line-clamp-2 text-[11px] leading-4">
            {artifact.description ?? "Created by Chief in this channel."}
          </span>
        </span>
        <ArrowRight
          size={13}
          className="text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5"
        />
      </span>
    </button>
  );
}

export function ChannelCanvas({
  channelId,
  channelName,
  description,
  onContinueArtifact,
  onOpenMessages,
}: {
  channelId: string;
  channelName: string;
  description: string;
  onContinueArtifact: (artifact: ExecutorArtifactSummary) => void;
  onOpenMessages: () => void;
}) {
  const { cloudOrganizationId } = useAuth();
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const { integrations } = useLocalIntegrationStatus();
  const [organization, setOrganization] = useState<AuthOrganization | null>(
    () => cachedAuthOrganization(cloudOrganizationId),
  );
  const { artifacts, loading: artifactsLoading } =
    useExecutorArtifacts(cloudOrganizationId);
  const isGettingStarted =
    channelId === GETTING_STARTED_CHANNEL_RELAY_ID ||
    channelName === "getting-started";

  useEffect(() => {
    if (!cloudOrganizationId) return;
    let cancelled = false;
    void listAuthOrganizations().then((organizations) => {
      if (cancelled) return;
      setOrganization(
        organizations.find((item) => item.id === cloudOrganizationId) ?? null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [cloudOrganizationId]);

  const checklist = useMemo<ChecklistItem[]>(() => {
    const selectedDomains = selectedIntegrationDomains(organization);
    const connectedDomains = new Set(
      (integrations ?? [])
        .filter((integration) => integration.status === "connected")
        .map((integration) => integration.provider),
    );
    const connectionsComplete =
      integrations !== null &&
      selectedDomains.every((domain) => {
        const provider = PROVIDER_BY_DOMAIN.get(domain);
        return (
          connectedDomains.has(domain) ||
          (provider ? connectedDomains.has(provider) : false)
        );
      });
    return [
      {
        id: "workspace",
        title: "Workspace profile",
        detail: "Your company context and operating preferences are saved.",
        complete: organization !== null,
      },
      {
        id: "connections",
        title: "Connect selected tools",
        detail:
          selectedDomains.length > 0
            ? "Setup will open secure provider sign-in when you start this step."
            : "No provider connections were selected during onboarding.",
        complete: connectionsComplete,
      },
      {
        id: "research",
        title: "Build the initial picture",
        detail: "Ask Chief to coordinate brand, market, and prospect research.",
        complete:
          workspaceData.prospects.length > 0 || workspaceData.drafts.length > 0,
      },
      {
        id: "recurring",
        title: "Confirm recurring work",
        detail: "Review what the team will run and when it needs approval.",
        complete: workspaceData.recurringWork.length > 0,
      },
    ];
  }, [integrations, organization, workspaceData]);

  const firstIncomplete = checklist.findIndex((item) => !item.complete);
  const channelArtifacts = chiefArtifacts(artifacts).filter(
    (artifact) => artifact.channelId === channelName,
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-channel-id={channelId}>
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <header className="flex items-start justify-between gap-6">
          <div>
            <p className="text-muted-foreground text-[11px] font-medium tracking-[0.08em] uppercase">
              {isGettingStarted ? "Setup canvas" : "Channel canvas"}
            </p>
            <h2 className="mt-2 text-2xl font-normal tracking-[-0.035em]">
              {isGettingStarted
                ? "Get Chief ready for useful work"
                : `#${channelName}`}
            </h2>
            <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
              {isGettingStarted
                ? "A shared checklist for you, Chief, and Setup. Conversation stays in Messages; durable setup state and outputs live here."
                : description}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onOpenMessages}>
            <MessageSquareText size={13} /> Messages
          </Button>
        </header>

        {isGettingStarted ? (
          <section className="bg-popover mt-7 overflow-hidden rounded-2xl border shadow-sm">
            <div className="flex items-center gap-2 border-b px-5 py-4">
              <ListChecks size={15} className="text-muted-foreground" />
              <h3 className="text-sm font-medium">Setup checklist</h3>
              <span className="text-muted-foreground ml-auto text-[11px]">
                {checklist.filter((item) => item.complete).length}/
                {checklist.length}
              </span>
            </div>
            <div className="divide-y">
              {checklist.map((item, index) => {
                const current = !item.complete && index === firstIncomplete;
                return (
                  <button
                    type="button"
                    key={item.id}
                    disabled={item.complete}
                    onClick={item.complete ? undefined : onOpenMessages}
                    className={cn(
                      "flex w-full items-start gap-3 px-5 py-4 text-left",
                      !item.complete && "hover:bg-accent/60",
                    )}
                  >
                    {item.complete ? (
                      <span className="bg-foreground text-background mt-0.5 grid size-5 place-items-center rounded-full">
                        <Check size={12} strokeWidth={2.4} />
                      </span>
                    ) : (
                      <Circle
                        size={20}
                        className={cn(
                          "text-muted-foreground mt-0.5",
                          current && "text-foreground",
                        )}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block text-sm",
                          item.complete
                            ? "text-muted-foreground line-through"
                            : "font-medium",
                        )}
                      >
                        {item.title}
                      </span>
                      <span className="text-muted-foreground mt-1 block text-xs leading-5">
                        {item.detail}
                      </span>
                    </span>
                    {current ? (
                      <span className="bg-accent mt-0.5 rounded-md px-2 py-1 text-[10px] font-medium">
                        Next
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <FileStack size={14} className="text-muted-foreground" />
            <h3 className="text-sm font-medium">Artifacts</h3>
            {channelArtifacts.length > 0 ? (
              <span className="text-muted-foreground text-[11px]">
                {channelArtifacts.length}
              </span>
            ) : null}
          </div>
          {channelArtifacts.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {channelArtifacts.map((artifact) => (
                <CanvasArtifact
                  key={artifact.id}
                  artifact={artifact}
                  onContinue={() => onContinueArtifact(artifact)}
                />
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground flex min-h-32 items-center justify-center rounded-2xl border border-dashed px-6 text-center text-xs leading-5">
              {artifactsLoading
                ? "Loading channel artifacts…"
                : "Artifacts Chief creates in this channel will stay co-located here."}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
