import { useSearchParams } from "react-router";
import type { AgentDefinition } from "@marketer/agent-runtime/types";
import { cn } from "@marketer/ui/lib/utils";
import { useRuntime } from "../lib/runtime";
import { AgentChat } from "../components/chat/agent-chat";

function AgentRow({
  agent,
  active,
  onSelect,
}: {
  agent: AgentDefinition;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full border border-transparent p-3 text-left transition-colors hover:bg-accent",
        active && "border-border bg-accent",
      )}
    >
      <span className="block text-sm font-medium leading-tight">
        {agent.name}
        {agent.delegates && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            Orchestrator
          </span>
        )}
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">
        {agent.role}
      </span>
    </button>
  );
}

export function AgentsPage() {
  const { agents } = useRuntime();
  const [params, setParams] = useSearchParams();
  const activeId = params.get("agent") ?? "cmo";
  const initialPrompt = params.get("prompt") ?? undefined;
  const active = agents.find((a) => a.id === activeId);

  return (
    <div className="flex h-[calc(100vh-96px)] gap-6">
      <div className="w-64 shrink-0 space-y-1 overflow-y-auto border-r pr-4 pt-6">
        <p className="px-3 pb-2 text-xs text-muted-foreground">Your team</p>
        {agents.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            active={agent.id === activeId}
            onSelect={() => setParams({ agent: agent.id })}
          />
        ))}
        {agents.length === 0 && (
          <p className="px-3 text-xs text-muted-foreground">
            Waiting for the agent runtime…
          </p>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {active ? (
          <AgentChat
            key={active.id}
            agent={active}
            initialPrompt={initialPrompt}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select an agent
          </div>
        )}
      </div>
    </div>
  );
}
