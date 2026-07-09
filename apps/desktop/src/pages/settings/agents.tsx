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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@marketer/ui/components/select";
import { Switch } from "@marketer/ui/components/switch";
import { cn } from "@marketer/ui/lib/utils";
import {
  type AgentOverride as LocalAgentOverride,
  getAgentOverride,
  setAgentOverride,
} from "../../lib/agent-overrides";
import { PROVIDER_META, type Provider } from "../../lib/providers";

type AgentOverride = Doc<"agent">;

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

function ProviderOption({ provider }: { provider: Provider }) {
  const { label, Icon } = PROVIDER_META[provider];
  return (
    <span className="flex items-center gap-2">
      <Icon size={14} />
      {label}
    </span>
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
  const vercelUrl = override?.vercelUrl ?? "";
  const vercelKey = override?.vercelKey ?? "";

  const save = (patch: {
    enabled?: boolean;
    driver?: Provider;
    vercelUrl?: string;
    vercelKey?: string;
  }) => {
    // Convex is the durable record; the localStorage mirror is what the live
    // chat runtime reads when opening sessions. Keep both in sync.
    const mirror: LocalAgentOverride = {};
    if ("enabled" in patch) mirror.enabled = patch.enabled;
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

  const meta = PROVIDER_META[driver];
  const TriggerIcon = meta.Icon;

  return (
    <div className={cn("space-y-4 py-5", !enabled && "opacity-60")}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{agent.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {agent.role}
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={!ready}
          onCheckedChange={(checked) => save({ enabled: checked })}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">
          Default provider
        </label>
        <div className="flex items-center gap-3">
          <Select
            value={driver}
            disabled={!ready}
            onValueChange={(value) => save({ driver: value as Provider })}
          >
            <SelectTrigger className="w-44">
              <span className="flex items-center gap-2">
                <TriggerIcon size={14} />
                {meta.label}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Local</SelectLabel>
                <SelectItem value="claude">
                  <ProviderOption provider="claude" />
                </SelectItem>
                <SelectItem value="codex">
                  <ProviderOption provider="codex" />
                </SelectItem>
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Deployed</SelectLabel>
                <SelectItem value="vercel">
                  <ProviderOption provider="vercel" />
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {meta.location === "Local"
              ? "Local, runs on this machine"
              : "Deployed, runs remotely"}
          </span>
        </div>
      </div>

      {driver === "vercel" && (
        <div className="grid grid-cols-2 gap-3">
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
            Deployed agents are not available yet. The endpoint is saved for
            when they are.
          </p>
        </div>
      )}
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
          Enable agents and set the default provider each one runs on. You can
          switch providers per chat.
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
            Connecting to your workspace…
          </p>
        )}
      </CardContent>
    </Card>
  );
}
