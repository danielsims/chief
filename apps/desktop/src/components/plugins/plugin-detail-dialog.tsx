import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, LoaderCircle } from "lucide-react";

import type {
  AgentPluginSummary,
  AgentPluginToolInput,
} from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { cn } from "@chief/ui/lib/utils";

import type { PluginAgentAccessState } from "./plugin-agent-access";
import { canManagePlugins } from "../../lib/auth/organization-role";
import {
  PLUGIN_CONNECTED_EVENT,
  pluginConnectedSchema,
} from "../../lib/plugin-connected";
import { pluginDomain } from "../../lib/plugin-presentation";
import { toolInputs } from "../../lib/relay-runtime-plugins";
import { useRelaySession } from "../../lib/relay-session";
import { useWorkspaceRole } from "../../lib/workspace-role";
import { ProviderLogo } from "../provider-logo";
import { PluginAgentAccess, usePluginAgentAccess } from "./plugin-agent-access";

interface WalkthroughTool {
  name: string;
  title?: string;
  description?: string;
  readOnly?: boolean;
  inputs?: AgentPluginToolInput[];
}

function toolLabel(tool: WalkthroughTool) {
  if (tool.title) return tool.title;
  const words = tool.name
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

function statusLine(plugin: AgentPluginSummary) {
  switch (plugin.status) {
    case "connected":
      return { tone: "bg-emerald-500", label: "Connected" };
    case "waiting":
      return { tone: "bg-amber-500", label: "Waiting for you to sign in" };
    case "authorization_required":
      return { tone: "bg-amber-500", label: "Needs sign-in" };
    case "reconnect":
      return { tone: "bg-amber-500", label: "Sign in again to keep using it" };
    case "failed":
    case "error":
      return {
        tone: "bg-destructive",
        label: plugin.diagnostics?.at(-1) ?? "Couldn't connect",
      };
    case "installed":
      return { tone: "bg-emerald-500", label: "Added" };
    case "available":
      return { tone: "bg-muted-foreground/60", label: "Requires setup" };
    default:
      return null;
  }
}

function ToolRow({
  tool,
  open,
  onToggle,
}: {
  tool: WalkthroughTool;
  open: boolean;
  onToggle: () => void;
}) {
  const inputs = tool.inputs ?? [];
  return (
    <li className="border-foreground/10 border-b last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        disabled={!tool.description && !tool.inputs?.length}
        onClick={onToggle}
        className="flex h-10 w-full items-center gap-2 text-left text-[13px] font-medium disabled:cursor-default"
      >
        <span className="min-w-0 flex-1 truncate">{toolLabel(tool)}</span>
        {tool.description || tool.inputs?.length ? (
          <ChevronDown
            size={14}
            className={cn(
              "text-muted-foreground shrink-0 transition-transform",
              !open && "-rotate-90",
            )}
          />
        ) : null}
      </button>
      {open ? (
        <div className="space-y-3 pb-3">
          <p className="text-muted-foreground text-[13px] leading-5 whitespace-pre-line">
            {tool.description}
          </p>
          {inputs.length ? (
            <div>
              <p className="text-muted-foreground mb-1 text-[13px]">Inputs</p>
              <ul className="space-y-1">
                {inputs.map((input) => (
                  <li
                    key={input.name}
                    className="flex items-baseline gap-2 text-[13px]"
                  >
                    <span className="font-code text-[12px]">{input.name}</span>
                    <span className="text-muted-foreground">{input.type}</span>
                    {input.required ? (
                      <span className="text-muted-foreground ml-auto">
                        Required
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function CountPill({ count, active }: { count: number; active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[12px] font-medium tabular-nums",
        active ? "bg-primary text-primary-foreground" : "bg-foreground/10",
      )}
    >
      {count}
    </span>
  );
}

/** Write and Read as two headings to switch between, so neither is a scroll away. */
function ToolsPane({
  name,
  tools,
}: {
  name: string;
  tools: WalkthroughTool[];
}) {
  const groups = [
    { label: "Write", tools: tools.filter((tool) => !tool.readOnly) },
    { label: "Read", tools: tools.filter((tool) => tool.readOnly) },
  ].filter((group) => group.tools.length > 0);
  const [selected, setSelected] = useState(groups[0]?.label);
  const shown = groups.find((group) => group.label === selected) ?? groups[0];
  // One tool open at a time.
  const [openTool, setOpenTool] = useState<string | null>(null);
  return (
    <>
      <PaneHeading
        title={`What agents can do in ${name}`}
        detail="Every tool this plugin gives an agent that you allow to use it."
      />
      <div className="border-foreground/10 mb-1 flex items-center gap-4 border-b pb-3">
        {groups.map((group) => (
          <button
            key={group.label}
            type="button"
            aria-pressed={group === shown}
            onClick={() => setSelected(group.label)}
            className={cn(
              "flex items-center gap-2 text-[15px] font-medium transition-colors",
              group === shown
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {group.label}
            <CountPill count={group.tools.length} active={group === shown} />
          </button>
        ))}
      </div>
      <ul>
        {shown?.tools.map((tool) => (
          <ToolRow
            key={tool.name}
            tool={tool}
            open={openTool === tool.name}
            onToggle={() =>
              setOpenTool((current) =>
                current === tool.name ? null : tool.name,
              )
            }
          />
        ))}
      </ul>
    </>
  );
}

type Step = "connected" | "tools" | "agents";

function PaneHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-[15px] leading-6 font-medium">{title}</h3>
      <p className="text-muted-foreground mt-0.5 text-[13px] leading-5">
        {detail}
      </p>
    </div>
  );
}

function ConnectedPane({ name }: { name: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 grid size-11 place-items-center rounded-full bg-emerald-500/15 text-emerald-500">
        <Check size={20} strokeWidth={2.5} />
      </span>
      <h3 className="text-[17px] leading-6 font-medium">{name} is connected</h3>
      <p className="text-muted-foreground mt-1.5 max-w-xs text-[13px] leading-5">
        Next, see what it can do and choose which of your agents can use it.
      </p>
    </div>
  );
}

function AgentsPane({
  name,
  connectionId,
  access,
}: {
  name: string;
  connectionId: string;
  access: PluginAgentAccessState;
}) {
  const none =
    access.agents.length > 0 && access.assigned(connectionId).size === 0;
  return (
    <>
      <PaneHeading
        title="Review agent access"
        detail={
          none
            ? `No agent can use ${name} yet. Agents only use plugins you allow.`
            : `Checked agents can use ${name}. Change this anytime in Plugins.`
        }
      />
      <PluginAgentAccess
        connectionId={connectionId}
        access={access}
        className="-mx-3 max-h-none overflow-visible rounded-none border-0"
      />
    </>
  );
}

/**
 * A plugin's details on the left and its tools and agents on the right. After
 * connecting, Continue walks from the tools to choosing agents.
 */
export function PluginWalkthrough({
  name,
  domain,
  description,
  status,
  host,
  tools,
  connectionId,
  actions,
  primary,
  placeholder,
  error,
  justConnected = false,
  onDone,
}: {
  name: string;
  domain: string;
  description: string;
  status?: { tone: string; label: string } | null;
  host?: string;
  tools: WalkthroughTool[];
  connectionId?: string;
  /** Secondary actions, such as Reconnect and Disconnect. */
  actions?: ReactNode;
  /** Replaces Continue while the plugin isn't connected yet. */
  primary?: ReactNode;
  /** Shown on the right when there are no tools or agents yet. */
  placeholder?: string;
  error?: string;
  /** Walks from a success message through tools to agent access. */
  justConnected?: boolean;
  onDone: () => void;
}) {
  const [step, setStep] = useState<Step>(justConnected ? "connected" : "tools");
  const access = usePluginAgentAccess(connectionId ?? "");
  const [expanded, setExpanded] = useState(false);
  const pages: Step[] = [
    ...(tools.length ? (["tools"] as const) : []),
    ...(connectionId ? (["agents"] as const) : []),
  ];
  const steps: Step[] = [
    ...(justConnected && connectionId ? (["connected"] as const) : []),
    ...pages,
  ];
  const current = steps.includes(step) ? step : steps[0];
  const index = current ? steps.indexOf(current) : -1;
  const next = steps[index + 1];
  const previous = index > 0 ? steps[index - 1] : undefined;
  // A new connection starts with every agent you manage allowed, shown on
  // the review step before you finish, where any can be unchecked.
  const granted = useRef(false);
  useEffect(() => {
    if (!justConnected || !connectionId || current !== "agents") return;
    if (granted.current || !access.editable) return;
    granted.current = true;
    const assigned = access.assigned(connectionId);
    const missing = access.agents
      .filter((agent) => !agent.disabledReason && !assigned.has(agent.id))
      .map((agent) => agent.id);
    if (missing.length)
      void access.setAccess(missing, connectionId, true).catch(() => undefined);
  }, [access, connectionId, current, justConnected]);
  return (
    <div className="grid h-[min(600px,85vh)] grid-cols-[264px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto]">
      <aside className="border-foreground/10 flex min-h-0 flex-col overflow-y-auto border-r p-6">
        <ProviderLogo
          domain={domain}
          label={name}
          className="mb-4 size-12 rounded-[14px]"
        />
        <DialogTitle className="flex items-baseline gap-2 text-[19px] leading-6 font-semibold tracking-[-0.02em]">
          {name}
          <span className="text-muted-foreground text-[15px] font-normal">
            Plugin
          </span>
        </DialogTitle>
        <DialogDescription
          className={cn(
            "text-foreground/80 mt-2 text-[13px] leading-5",
            !expanded && "line-clamp-5",
          )}
        >
          {description}
        </DialogDescription>
        {description.length > 200 ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-muted-foreground hover:text-foreground mt-1 self-start text-[13px] transition-colors"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        ) : null}
        {status ? (
          <p className="text-muted-foreground mt-4 flex min-w-0 items-center gap-2 text-[13px]">
            <span
              className={cn("size-1.5 shrink-0 rounded-full", status.tone)}
            />
            <span className="truncate">{status.label}</span>
          </p>
        ) : null}
        {host ? (
          <p className="text-muted-foreground/70 mt-1 truncate text-[13px]">
            {host}
          </p>
        ) : null}
        {pages.length ? (
          <nav className="-mx-2 mt-6 space-y-0.5">
            {pages.map((item) => (
              <button
                key={item}
                type="button"
                aria-current={item === current ? "page" : undefined}
                onClick={() => setStep(item)}
                className={cn(
                  "flex h-8 w-full items-center rounded-md px-2 text-left text-[13px] transition-colors",
                  item === current
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item === "tools" ? "Tools" : "Agents"}
                <span className="text-muted-foreground ml-auto text-[13px] tabular-nums">
                  {item === "tools" ? tools.length : null}
                </span>
              </button>
            ))}
          </nav>
        ) : null}
      </aside>

      <div className="min-h-0 overflow-y-auto px-6 pt-6 pb-4">
        {current === "connected" ? (
          <ConnectedPane name={name} />
        ) : current === "agents" && connectionId ? (
          <AgentsPane name={name} connectionId={connectionId} access={access} />
        ) : current === "tools" ? (
          <ToolsPane name={name} tools={tools} />
        ) : placeholder ? (
          <p className="text-muted-foreground flex h-full items-center justify-center text-center text-[13px]">
            {placeholder}
          </p>
        ) : null}
        {error ? (
          <p className="text-destructive mt-3 text-[13px] leading-5">{error}</p>
        ) : null}
      </div>

      <footer className="border-foreground/10 col-span-2 flex h-14 items-center gap-2 border-t px-4">
        {previous ? (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-md"
            onClick={() => setStep(previous)}
          >
            Back
          </Button>
        ) : null}
        {justConnected ? null : actions}
        <span className="ml-auto" />
        {primary ??
          (next ? (
            <Button
              size="sm"
              className="rounded-md"
              onClick={() => setStep(next)}
            >
              Continue
            </Button>
          ) : (
            <Button size="sm" className="rounded-md" onClick={onDone}>
              Done
            </Button>
          ))}
      </footer>
    </div>
  );
}

const catalogToolsCache = new Map<string, WalkthroughTool[]>();

/** What an unconnected catalog plugin offers, as the relay last saw it. */
function useCatalogTools(plugin: AgentPluginSummary | null) {
  const { client } = useRelaySession();
  const domain =
    plugin?.source.type === "discovery" && !plugin.connection?.tools.length
      ? plugin.source.domain
      : undefined;
  const [loaded, setLoaded] = useState<{
    domain: string;
    tools: WalkthroughTool[];
  } | null>(null);
  useEffect(() => {
    if (!client || !domain || catalogToolsCache.has(domain)) return;
    let active = true;
    void client.plugins
      .catalogTools(domain)
      .then((tools) => {
        const mapped = tools.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          readOnly: tool.readOnly,
          inputs: toolInputs(tool.inputSchema),
        }));
        catalogToolsCache.set(domain, mapped);
        if (active) setLoaded({ domain, tools: mapped });
      })
      .catch(() => {
        if (active) setLoaded({ domain, tools: [] });
      });
    return () => {
      active = false;
    };
  }, [client, domain]);
  if (!domain) return { tools: [], loading: false };
  const tools =
    catalogToolsCache.get(domain) ??
    (loaded?.domain === domain ? loaded.tools : undefined);
  return { tools: tools ?? [], loading: !tools };
}

export function PluginDetailDialog({
  plugin,
  busy,
  error,
  onClose,
  onAdd,
  onConnect,
  onReplaceKey,
  onRemove,
}: {
  plugin: AgentPluginSummary | null;
  busy: boolean;
  /** The last action's failure, such as the relay refusing a member. */
  error?: string;
  onClose: () => void;
  onAdd: (plugin: AgentPluginSummary) => void;
  onConnect: (plugin: AgentPluginSummary) => void;
  onReplaceKey: (plugin: AgentPluginSummary) => void;
  onRemove: (plugin: AgentPluginSummary) => void;
}) {
  // Restarts the walkthrough when this plugin finishes connecting.
  const [run, setRun] = useState(0);
  const canManage = canManagePlugins(useWorkspaceRole());
  const pluginId = plugin?.id;
  useEffect(() => {
    if (!pluginId) return;
    const connected = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const input = pluginConnectedSchema.safeParse(event.detail);
      if (input.data?.pluginId !== pluginId) return;
      // This dialog walks through it, so the standalone one stays closed.
      event.preventDefault();
      setRun((value) => value + 1);
    };
    window.addEventListener(PLUGIN_CONNECTED_EVENT, connected);
    return () => window.removeEventListener(PLUGIN_CONNECTED_EVENT, connected);
  }, [pluginId]);
  const catalog = useCatalogTools(plugin);
  const status = plugin ? statusLine(plugin) : null;
  const added = plugin && plugin.status !== "available";
  const connected = plugin?.status === "connected";
  const auth = plugin?.connection?.auth;

  return (
    <Dialog
      open={Boolean(plugin)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="border-border/80 w-[calc(100%-32px)] max-w-[800px] gap-0 overflow-hidden rounded-2xl p-0 shadow-[0_16px_64px_-12px_rgb(0_0_0/0.45)]">
        {plugin ? (
          <PluginWalkthrough
            key={`${plugin.id}:${run}`}
            name={plugin.name}
            domain={pluginDomain(plugin)}
            description={plugin.description}
            status={status}
            host={
              plugin.connection
                ? new URL(plugin.connection.url).hostname
                : undefined
            }
            tools={
              plugin.connection?.tools.length
                ? plugin.connection.tools
                : catalog.tools
            }
            connectionId={connected ? plugin.connection?.id : undefined}
            justConnected={run > 0 && connected}
            error={error}
            onDone={onClose}
            placeholder={
              connected || plugin.status === "installed" || catalog.loading
                ? undefined
                : `${plugin.name} shows its tools once it's connected.`
            }
            actions={
              canManage ? (
                <>
                  {auth === "headers" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-md"
                      disabled={busy}
                      onClick={() => onReplaceKey(plugin)}
                    >
                      Replace key
                    </Button>
                  ) : auth === "oauth" && connected ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-md"
                      disabled={busy}
                      onClick={() => onConnect(plugin)}
                    >
                      Reconnect
                    </Button>
                  ) : null}
                  {added ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground rounded-md"
                      disabled={busy}
                      onClick={() => onRemove(plugin)}
                    >
                      {connected || plugin.status === "installed"
                        ? "Disconnect"
                        : "Remove"}
                    </Button>
                  ) : null}
                </>
              ) : undefined
            }
            primary={
              connected ||
              plugin.status === "installed" ? undefined : !canManage ? (
                <Button size="sm" className="rounded-md" disabled>
                  Ask an admin
                </Button>
              ) : (
                // Keeps its size while working, so the footer doesn't move.
                <Button
                  size="sm"
                  className="relative rounded-md"
                  disabled={busy}
                  onClick={() =>
                    plugin.status === "available"
                      ? onAdd(plugin)
                      : onConnect(plugin)
                  }
                >
                  <span className={cn(busy && "invisible")}>
                    {plugin.status === "reconnect" ? "Reconnect" : "Install"}
                  </span>
                  {busy ? (
                    <LoaderCircle
                      className="absolute inset-0 m-auto animate-spin"
                      size={14}
                    />
                  ) : null}
                </Button>
              )
            }
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
