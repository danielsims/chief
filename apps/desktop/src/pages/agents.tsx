import { type ComponentProps, useEffect, useState } from "react";
import { Link } from "react-router";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@marketer/backend/convex/_generated/api";
import type { Doc } from "@marketer/backend/convex/_generated/dataModel";
import { defaultAgents } from "@marketer/agent-runtime/agents";
import type { AgentDefinition } from "@marketer/agent-runtime/types";
import { Button } from "@marketer/ui/components/button";
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
import { useRuntime } from "../lib/runtime";
import {
  type AgentOverride as LocalAgentOverride,
  getAgentOverride,
  getWorkspaceProvider,
  setAgentOverride,
} from "../lib/agent-overrides";
import { PROVIDER_META, type Provider } from "../lib/providers";

type AgentOverride = Doc<"agent">;

/**
 * Agents a registry backend will offer later. Shown here so the page reads
 * as a registry from day one; install mechanics come with the registry PRD.
 */
const availableAgents = [
  {
    id: "seo",
    name: "SEO specialist",
    role: "Search & site content",
    description:
      "Audits your site, finds keyword gaps and drafts pages that can rank.",
  },
  {
    id: "email",
    name: "Email marketer",
    role: "Lifecycle & newsletters",
    description:
      "Writes campaigns and drip sequences and keeps your list healthy.",
  },
  {
    id: "community",
    name: "Community manager",
    role: "Community & replies",
    description:
      "Watches your channels for mentions and drafts replies in your voice.",
  },
  {
    id: "brand",
    name: "Brand designer",
    role: "Visual identity",
    description:
      "Keeps logos, colors and social templates consistent across channels.",
  },
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

function ProviderOption({ provider }: { provider: Provider }) {
  const { label, Icon } = PROVIDER_META[provider];
  return (
    <span className="flex items-center gap-2">
      <Icon size={14} />
      {label}
    </span>
  );
}

function InstalledAgentCard({
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
  // Per-agent override wins; otherwise the workspace's chosen agent app.
  // Null means neither exists yet — the select asks instead of assuming.
  const driver = (override?.driver ??
    getWorkspaceProvider() ??
    null) as Provider | null;
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
      console.error(`[Agents] Failed to save ${agent.name}:`, error);
    });
  };

  const meta = driver ? PROVIDER_META[driver] : null;

  return (
    <div
      className={cn(
        "flex flex-col border bg-card p-5",
        !enabled && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {agent.name}
            {agent.delegates && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                Orchestrator
              </span>
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">{agent.role}</p>
        </div>
        <Switch
          checked={enabled}
          disabled={!ready}
          onCheckedChange={(checked) => save({ enabled: checked })}
        />
      </div>

      <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">
        {agent.description}
      </p>

      {driver === "vercel" && (
        <div className="mt-4 grid grid-cols-2 gap-3">
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

      <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
        <div className="flex items-center gap-2">
          <Select
            value={driver ?? undefined}
            disabled={!ready}
            onValueChange={(value) => save({ driver: value as Provider })}
          >
            <SelectTrigger className="h-7 w-auto gap-1.5 border-transparent px-1 text-xs text-muted-foreground hover:text-foreground data-[state=open]:text-foreground">
              {meta ? (
                <span className="flex items-center gap-1.5">
                  <meta.Icon size={13} />
                  {meta.label}
                </span>
              ) : (
                <span>Choose agent app</span>
              )}
            </SelectTrigger>
            <SelectContent className="min-w-36">
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
          {meta ? (
            <span className="text-xs text-muted-foreground">
              {meta.location}
            </span>
          ) : null}
        </div>
        <Link
          to={`/conversations?agent=${agent.id}`}
          className="border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Open chat
        </Link>
      </div>
    </div>
  );
}

function AvailableAgentCard({
  agent,
}: {
  agent: (typeof availableAgents)[number];
}) {
  return (
    <div className="flex flex-col border border-dashed p-5">
      <div>
        <p className="text-sm font-medium">{agent.name}</p>
        <p className="text-xs text-muted-foreground">{agent.role}</p>
      </div>
      <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">
        {agent.description}
      </p>
      <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
        <span className="text-xs text-muted-foreground">Coming soon</span>
        <Button size="sm" variant="outline" disabled className="h-7 text-xs">
          Install
        </Button>
      </div>
    </div>
  );
}

export function AgentsPage() {
  const { agents: runtimeAgents } = useRuntime();
  // The runtime roster when connected; the static roster as a fallback so
  // the registry still renders while the runtime is down.
  const agents = runtimeAgents.length > 0 ? runtimeAgents : defaultAgents;

  const { isAuthenticated: convexReady } = useConvexAuth();
  const overrides = useQuery(
    api.agents.listOverrides,
    convexReady ? {} : "skip",
  );
  const ready = convexReady && overrides !== undefined;
  const [view, setView] = useState<"installed" | "available">("installed");

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
      if (
        override.enabled !== undefined &&
        local.enabled !== override.enabled
      ) {
        patch.enabled = override.enabled;
      }
      if (Object.keys(patch).length > 0) {
        setAgentOverride(override.agentKey, patch);
      }
    }
  }, [overrides]);

  return (
    <div className="-mb-8 flex min-h-[calc(100vh-48px)]">
      <aside className="w-56 shrink-0 border-r px-5 pt-10">
        <h1 className="font-serif text-3xl">Agents</h1>
        <nav className="mt-7 space-y-1">
          {[
            {
              key: "installed" as const,
              label: "Installed",
              count: agents.length,
            },
            {
              key: "available" as const,
              label: "Available",
              count: availableAgents.length,
            },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setView(item.key)}
              className={cn(
                "flex w-full items-center justify-between px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                view === item.key && "bg-accent text-foreground",
              )}
            >
              <span>{item.label}</span>
              <span className="text-[11px] text-muted-foreground">
                {item.count}
              </span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 px-6 pb-8 pt-10">
        <div className="mb-6">
          <h2 className="font-serif text-2xl">
            {view === "installed" ? "Your team" : "Available agents"}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            {view === "installed"
              ? "Enable agents, choose the provider each one runs on, and open a conversation."
              : "Specialists that can be added to the workspace as the registry expands."}
          </p>
        </div>

        {view === "installed" ? (
          <>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {agents.map((agent) => (
                <InstalledAgentCard
                  key={agent.id}
                  agent={agent}
                  override={overrides?.find((o) => o.agentKey === agent.id)}
                  ready={ready}
                />
              ))}
            </div>
            {!convexReady ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Connecting to your workspace…
              </p>
            ) : null}
          </>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {availableAgents.map((agent) => (
              <AvailableAgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
