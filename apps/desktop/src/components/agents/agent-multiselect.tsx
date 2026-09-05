import { useId, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";

import { AgentAvatar } from "../agent-avatar";

export interface SelectableAgent {
  id: string;
  name: string;
  role?: string;
  imageURL?: string | null;
}

export function AgentMultiselect({
  agents,
  value,
  onChange,
  disabled = false,
}: {
  agents: readonly SelectableAgent[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const id = useId();
  const matching = agents.filter((agent) =>
    `${agent.name} ${agent.role ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const selected = agents.filter((agent) => value.includes(agent.id));
  const toggle = (agentId: string) => {
    if (!value.includes(agentId) && value.length >= 12) return;
    onChange(
      value.includes(agentId)
        ? value.filter((id) => id !== agentId)
        : [...value, agentId],
    );
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-controls={id}
          aria-label="Collaborators"
          className="h-auto min-h-10 w-full justify-between rounded-md px-3 py-2 font-normal"
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left">
            {selected.length ? (
              selected.map((agent) => (
                <span key={agent.id} className="flex items-center gap-1.5">
                  <TeamAvatar agent={agent} />
                  {agent.name}
                </span>
              ))
            ) : (
              <span className="text-muted-foreground">Add teammates</span>
            )}
          </span>
          <ChevronsUpDown className="text-muted-foreground size-3.5 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-64 rounded-lg p-1.5 shadow-xl shadow-black/30 dark:shadow-black/70"
      >
        <div className="relative mb-1 border-b pb-1.5">
          <Search className="text-muted-foreground absolute top-3 left-2 size-4" />
          <Input
            role="combobox"
            aria-label="Search agents"
            aria-controls={id}
            aria-expanded={open}
            aria-autocomplete="list"
            aria-activedescendant={
              matching.length
                ? `${id}-${Math.min(active, matching.length - 1)}`
                : undefined
            }
            placeholder="Search agents…"
            value={query}
            className="border-0 pl-8 shadow-none"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActive((current) =>
                  Math.max(
                    0,
                    Math.min(
                      matching.length - 1,
                      current + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
              }
              if (event.key === "Enter") {
                event.preventDefault();
                const agent = matching[Math.min(active, matching.length - 1)];
                if (agent) toggle(agent.id);
              }
            }}
          />
        </div>
        <div
          id={id}
          role="listbox"
          aria-label="Workspace agents"
          aria-multiselectable="true"
          className="max-h-56 overflow-auto"
        >
          {matching.map((agent, index) => (
            <button
              type="button"
              role="option"
              aria-selected={value.includes(agent.id)}
              id={`${id}-${index}`}
              key={agent.id}
              onMouseMove={() => setActive(index)}
              onClick={() => toggle(agent.id)}
              className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm ${active === index ? "bg-accent" : "hover:bg-accent"}`}
            >
              <TeamAvatar agent={agent} />
              <span className="min-w-0 flex-1 truncate">{agent.name}</span>
              {value.includes(agent.id) && <Check className="size-4" />}
            </button>
          ))}
          {!matching.length && (
            <p className="text-muted-foreground px-3 py-5 text-sm">
              No agents found.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TeamAvatar({ agent }: { agent: SelectableAgent }) {
  return agent.imageURL ? (
    <img
      src={agent.imageURL}
      alt=""
      className="size-6 shrink-0 rounded-full object-cover"
    />
  ) : (
    <AgentAvatar agentId={agent.id} label={agent.name} className="size-6" />
  );
}
