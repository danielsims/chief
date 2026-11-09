import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import type { RelayClient } from "@chief/relay-client";
import type { McpConnectionAccess } from "@chief/relay-contracts";
import { cn } from "@chief/ui/lib/utils";

import { useRelaySession } from "../../lib/relay-session";
import { AgentAvatar } from "../agent-avatar";

export interface PluginAccessAgent {
  id: string;
  name: string;
  parentId?: string;
  disabledReason?: string;
}

const accessCache = new Map<string, McpConnectionAccess>();

/** Uses the narrowly scoped API so members can manage their own agents. */
export function usePluginAgentAccess(connectionId: string) {
  const { client } = useRelaySession();
  const [result, setResult] = useState<{
    client: typeof client;
    connectionId: string;
    data: McpConnectionAccess | null;
    error: string;
  } | null>(null);
  const current =
    result?.client === client && result.connectionId === connectionId
      ? result
      : null;
  const data = current?.data ?? accessCache.get(connectionId) ?? null;
  const error = current?.error ?? "";
  const pending = useRef(0);
  useEffect(() => {
    let active = true;
    if (client && connectionId)
      void client.plugins
        .access(connectionId)
        .then((data) => {
          accessCache.set(connectionId, data);
          if (active) setResult({ client, connectionId, data, error: "" });
        })
        .catch((cause: unknown) => {
          if (active)
            setResult({
              client,
              connectionId,
              data: null,
              error:
                cause instanceof Error
                  ? cause.message
                  : "Could not load agent access.",
            });
        });
    return () => {
      active = false;
    };
  }, [client, connectionId]);
  const agents: PluginAccessAgent[] = (data?.agents ?? []).map((agent) => ({
    id: agent.id,
    name: agent.name,
    parentId: agent.parentId,
    disabledReason: agent.canEdit
      ? undefined
      : (agent.reason ?? "Only its owner can change access"),
  }));
  const setAccess = async (
    agentIds: Iterable<string>,
    id: string,
    on: boolean,
  ) => {
    if (!client) throw new Error("Chief is still connecting to the relay.");
    const ids = [...agentIds];
    const assign = (base: McpConnectionAccess, enabled: boolean) => {
      const assigned = new Set(base.assignedAgentIds);
      for (const agentId of ids)
        if (enabled) assigned.add(agentId);
        else assigned.delete(agentId);
      return { ...base, assignedAgentIds: [...assigned] };
    };
    const show = (next: McpConnectionAccess) => {
      accessCache.set(id, next);
      setResult({ client, connectionId: id, data: next, error: "" });
    };
    // The check moves at once; the relay's answer replaces it when the last
    // change in flight settles.
    if (data) show(assign(data, on));
    pending.current += 1;
    try {
      const next = await client.plugins.setAccess(id, ids, on);
      pending.current -= 1;
      if (pending.current === 0) show(next);
    } catch (cause) {
      pending.current -= 1;
      const latest = accessCache.get(id);
      if (latest) show(assign(latest, !on));
      throw cause;
    }
  };
  return {
    agents,
    editable: Boolean(data),
    error,
    loading: !data && !error,
    assigned: (_id: string) => new Set(data?.assignedAgentIds ?? []),
    setAccess,
  };
}

function CheckMark({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
        on
          ? "border-foreground bg-foreground text-background"
          : "border-foreground/35 text-transparent",
      )}
    >
      <Check size={12} strokeWidth={2.75} aria-hidden="true" />
    </span>
  );
}

/** Each check changes only that agent; subagents sit in a tree under their parent. */
export function AgentAccessList({
  agents,
  selected,
  disabled,
  onToggle,
  onToggleMany,
  className,
}: {
  agents: readonly PluginAccessAgent[];
  selected: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (agentId: string, on: boolean) => void;
  onToggleMany?: (agentIds: string[], on: boolean) => void;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(new Set<string>());
  const row = (agent: PluginAccessAgent, extra?: ReactNode) => {
    const on = selected.has(agent.id);
    const locked = disabled || Boolean(agent.disabledReason);
    return (
      <div className="flex min-h-11 items-center gap-2 px-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={on}
          disabled={locked}
          title={agent.disabledReason}
          onClick={() => onToggle(agent.id, !on)}
          className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left text-[13px] font-medium disabled:cursor-default disabled:opacity-60"
        >
          <AgentAvatar
            agentId={agent.id}
            label={agent.name}
            className={cn(
              "rounded-lg",
              agent.parentId ? "size-6 rounded-md" : "size-7",
            )}
            markTileClassName="bg-foreground text-background"
          />
          <span className="min-w-0 flex-1 truncate">{agent.name}</span>
        </button>
        {extra}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          disabled={locked}
          onClick={() => onToggle(agent.id, !on)}
          className="disabled:cursor-default disabled:opacity-60"
        >
          <CheckMark on={on} />
        </button>
      </div>
    );
  };
  const group = (parent: PluginAccessAgent) => {
    const children = agents.filter((child) => child.parentId === parent.id);
    const open = expanded.has(parent.id);
    const eligible = children.filter((child) => !child.disabledReason);
    const all =
      eligible.length > 0 && eligible.every((child) => selected.has(child.id));
    const toggleAll = () => {
      const ids = eligible.map((child) => child.id);
      if (onToggleMany) onToggleMany(ids, !all);
      else for (const id of ids) onToggle(id, !all);
    };
    return (
      <div
        key={parent.id}
        className="border-foreground/10 border-b last:border-b-0"
      >
        {row(
          parent,
          children.length ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`Show ${parent.name} subagents`}
              onClick={() =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (open) next.delete(parent.id);
                  else next.add(parent.id);
                  return next;
                })
              }
              className="text-muted-foreground hover:text-foreground flex h-7 items-center gap-1 rounded-md px-2 text-[13px] transition-colors"
            >
              {children.length} subagents
              <ChevronDown
                size={14}
                className={cn("transition-transform", !open && "-rotate-90")}
              />
            </button>
          ) : null,
        )}
        {children.length && open ? (
          <div className="pb-2 pl-[26px]">
            <div className="border-foreground/15 border-l">
              <div className="flex min-h-9 items-center gap-2 pr-3 pl-5">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={all}
                  disabled={disabled || eligible.length === 0}
                  onClick={toggleAll}
                  className="text-muted-foreground hover:text-foreground flex-1 text-left text-[13px] transition-colors disabled:cursor-default"
                >
                  All subagents
                </button>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  disabled={disabled || eligible.length === 0}
                  onClick={toggleAll}
                >
                  <CheckMark on={all} />
                </button>
              </div>
              {children.map((child) => (
                <div key={child.id} className="-ml-px pl-2">
                  {row(child)}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  };
  return (
    <div
      className={cn("max-h-80 overflow-y-auto rounded-xl border", className)}
    >
      {agents.filter((agent) => !agent.parentId).map(group)}
    </div>
  );
}

/** Fills the cache first, so a dialog that opens afterwards shows the list at once. */
export async function preloadPluginAgentAccess(
  client: RelayClient,
  connectionId: string,
) {
  accessCache.set(connectionId, await client.plugins.access(connectionId));
}

export type PluginAgentAccessState = ReturnType<typeof usePluginAgentAccess>;

/** Agent access for a connected plugin; the caller owns the loaded state. */
export function PluginAgentAccess({
  connectionId,
  access,
  className,
}: {
  connectionId: string;
  access: PluginAgentAccessState;
  className?: string;
}) {
  const [error, setError] = useState("");
  if (!access.agents.length)
    return access.error ? (
      <p className="text-destructive px-3.5 py-2.5 text-xs">{access.error}</p>
    ) : null;
  const save = (agentIds: string[], on: boolean) => {
    setError("");
    void access
      .setAccess(agentIds, connectionId, on)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not update agent access.",
        ),
      );
  };
  return (
    <>
      <AgentAccessList
        agents={access.agents}
        selected={access.assigned(connectionId)}
        disabled={!access.editable}
        className={className}
        onToggleMany={save}
        onToggle={(agentId, on) => save([agentId], on)}
      />
      {error || access.error ? (
        <p className="text-destructive px-3.5 py-2 text-xs leading-5">
          {error || access.error}
        </p>
      ) : null}
    </>
  );
}
