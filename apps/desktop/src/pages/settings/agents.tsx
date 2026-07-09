import { type ComponentProps, useEffect, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@marketer/backend/convex/_generated/api";
import type { Doc } from "@marketer/backend/convex/_generated/dataModel";
import { defaultAgents } from "@marketer/agent-runtime/agents";
import type { AgentDefinition } from "@marketer/agent-runtime/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@marketer/ui/components/card";
import { Input } from "@marketer/ui/components/input";
import { Switch } from "@marketer/ui/components/switch";
import { cn } from "@marketer/ui/lib/utils";
import { AgentIcon } from "../../components/agent-icon";
import {
  type AgentOverride as LocalAgentOverride,
  getAgentOverride,
  setAgentOverride,
} from "../../lib/agent-overrides";

type AgentOverride = Doc<"agent">;
type Provider = "claude" | "codex" | "vercel";

const providers: { value: Provider; label: string; hint: string }[] = [
  { value: "claude", label: "claude", hint: "local CLI" },
  { value: "codex", label: "codex", hint: "local CLI" },
  { value: "vercel", label: "vercel", hint: "deployed endpoint" },
];

/** Input that keeps local state and commits on blur or Enter. */
function CommitInput({
  value,
  onCommit,
  ...props
}: {
  value: string;
  onCommit: (value: string) => void;
} & Omit<ComponentProps<typeof Input>, "value" | "onChange">) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <Input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft.trim());
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

function AgentSettingsRow({
  agent,
  override,
  ready,
}: {
  agent: AgentDefinition;
  override: AgentOverride | undefined;
  ready: boolean;
}) {
  const upsertOverride = useMutation(api.agents.upsertOverride);

  const enabled = override?.enabled ?? true;
  const driver = (override?.driver ?? agent.driver) as Provider;
  const model = override?.model ?? "";
  const vercelUrl = override?.vercelUrl ?? "";
  const vercelKey = override?.vercelKey ?? "";

  const save = (patch: {
    enabled?: boolean;
    model?: string;
    driver?: Provider;
    vercelUrl?: string;
    vercelKey?: string;
  }) => {
    // Convex is the durable record; the localStorage mirror is what the live
    // chat runtime reads when opening sessions. Keep both in sync.
    const mirror: LocalAgentOverride = {};
    if ("enabled" in patch) mirror.enabled = patch.enabled;
    if ("model" in patch) mirror.model = patch.model || undefined;
    if (patch.driver === "claude" || patch.driver === "codex") {
      mirror.driver = patch.driver;
    }
    if (Object.keys(mirror).length > 0) {
      setAgentOverride(agent.id, mirror);
    }

    upsertOverride({ agentKey: agent.id, ...patch }).catch((error) => {
      console.error(`[Settings] Failed to save ${agent.name}:`, error);
    });
  };

  return (
    <div className={cn("space-y-4 py-5", !enabled && "opacity-60")}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center border bg-background text-muted-foreground">
            <AgentIcon agentId={agent.id} size={15} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{agent.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {agent.role}
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          disabled={!ready}
          onCheckedChange={(checked) => save({ enabled: checked })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 pl-11">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Provider</label>
          <div className="flex h-9 w-fit border">
            {providers.map((provider, index) => (
              <button
                key={provider.value}
                type="button"
                disabled={!ready}
                title={provider.hint}
                onClick={() => save({ driver: provider.value })}
                className={cn(
                  "px-3 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
                  index > 0 && "border-l",
                  driver === provider.value &&
                    "bg-accent text-accent-foreground",
                )}
              >
                {provider.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">
            Model override
          </label>
          <CommitInput
            value={model}
            disabled={!ready}
            placeholder={agent.model ?? "provider default"}
            onCommit={(next) => save({ model: next })}
          />
        </div>
        {driver === "vercel" && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                Endpoint URL
              </label>
              <CommitInput
                value={vercelUrl}
                disabled={!ready}
                placeholder="https://agents.example.com/api/agent"
                onCommit={(next) => save({ vercelUrl: next })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">API key</label>
              <CommitInput
                value={vercelKey}
                disabled={!ready}
                type="password"
                placeholder="key"
                onCommit={(next) => save({ vercelKey: next })}
              />
            </div>
            <p className="col-span-2 text-xs text-muted-foreground">
              Deployed agents are not wired up yet. The endpoint is stored and
              will be used once remote execution ships.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export function AgentsSettings() {
  const { isAuthenticated: convexReady } = useConvexAuth();
  const overrides = useQuery(api.agents.listOverrides, convexReady ? {} : "skip");
  const ready = convexReady && overrides !== undefined;

  // Hydrate the runtime's localStorage mirror from the durable Convex record
  // so settings made on another machine apply to live chats here too.
  useEffect(() => {
    if (!overrides) return;
    for (const override of overrides) {
      const local = getAgentOverride(override.agentKey);
      const patch: LocalAgentOverride = {};
      const driver =
        override.driver === "claude" || override.driver === "codex"
          ? override.driver
          : undefined;
      if (driver && local.driver !== driver) patch.driver = driver;
      if ((override.model || undefined) !== local.model) {
        patch.model = override.model || undefined;
      }
      if (override.enabled !== undefined && local.enabled !== override.enabled) {
        patch.enabled = override.enabled;
      }
      if (Object.keys(patch).length > 0) {
        setAgentOverride(override.agentKey, patch);
      }
    }
  }, [overrides]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agents</CardTitle>
        <CardDescription>
          Your marketing team. Choose where each agent runs and which model it
          uses; settings apply to this workspace only.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {defaultAgents.map((agent) => (
          <AgentSettingsRow
            key={agent.id}
            agent={agent}
            override={overrides?.find((o) => o.agentKey === agent.id)}
            ready={ready}
          />
        ))}
        {!convexReady && (
          <p className="py-3 text-xs text-muted-foreground">
            Connecting to your cloud workspace...
          </p>
        )}
      </CardContent>
    </Card>
  );
}
