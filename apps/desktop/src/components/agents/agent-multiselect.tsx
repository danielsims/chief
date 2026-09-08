import { useEffect, useId, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";

import { Input } from "@chief/ui/components/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
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
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const matching = agents.filter((agent) =>
    `${agent.name} ${agent.role ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const selected = agents.filter((agent) => value.includes(agent.id));
  const activeIndex = Math.min(active, matching.length - 1);
  useEffect(() => {
    if (open) activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, query, open]);
  const toggle = (agentId: string) => {
    if (!value.includes(agentId) && value.length >= 12) return;
    onChange(
      value.includes(agentId)
        ? value.filter((id) => id !== agentId)
        : [...value, agentId],
    );
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  };
  return (
    <div className="space-y-2">
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute top-3 left-3 size-4"
            />
            <Input
              ref={inputRef}
              role="combobox"
              aria-label="Search teammates"
              aria-controls={open ? id : undefined}
              aria-expanded={open && !disabled}
              aria-autocomplete="list"
              aria-activedescendant={
                open && activeIndex >= 0 ? `${id}-${activeIndex}` : undefined
              }
              placeholder="Search agents…"
              value={query}
              disabled={disabled}
              className="h-10 pl-9 text-sm"
              onFocus={(event) => {
                setPortalContainer(
                  event.currentTarget.closest<HTMLElement>('[role="dialog"]'),
                );
                setOpen(true);
              }}
              onClick={() => setOpen(true)}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
                setOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && open) {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                } else if (
                  event.key === "ArrowDown" ||
                  event.key === "ArrowUp"
                ) {
                  event.preventDefault();
                  setOpen(true);
                  setActive((current) =>
                    Math.max(
                      0,
                      Math.min(
                        matching.length - 1,
                        open
                          ? current + (event.key === "ArrowDown" ? 1 : -1)
                          : 0,
                      ),
                    ),
                  );
                } else if (event.key === "Enter" && open) {
                  event.preventDefault();
                  const agent = matching[activeIndex];
                  if (agent) toggle(agent.id);
                } else if (event.key === "Tab") setOpen(false);
              }}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          portalContainer={portalContainer}
          collisionBoundary={portalContainer}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target === inputRef.current) event.preventDefault();
          }}
          className="w-[var(--radix-popover-trigger-width)] min-w-64 rounded-lg p-1.5 shadow-xl shadow-black/30 dark:shadow-black/70"
        >
          <div
            id={id}
            role="listbox"
            aria-label="Workspace agents"
            aria-multiselectable="true"
            className="max-h-[min(14rem,calc(var(--radix-popover-content-available-height)-12px))] overflow-y-auto overscroll-contain"
          >
            {matching.map((agent, index) => (
              <button
                type="button"
                role="option"
                tabIndex={-1}
                ref={index === activeIndex ? activeRef : undefined}
                aria-selected={value.includes(agent.id)}
                id={`${id}-${index}`}
                key={agent.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggle(agent.id)}
                className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm ${activeIndex === index ? "bg-accent" : "hover:bg-accent"}`}
              >
                <TeamAvatar agent={agent} />
                <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                {value.includes(agent.id) && (
                  <Check aria-hidden="true" className="size-4" />
                )}
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
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((agent) => (
            <button
              key={agent.id}
              type="button"
              disabled={disabled}
              aria-label={`Remove ${agent.name}`}
              onClick={() => toggle(agent.id)}
              className="bg-muted hover:bg-accent flex items-center gap-1.5 rounded-md px-2 py-1 text-sm"
            >
              <TeamAvatar agent={agent} />
              {agent.name}
              <X
                aria-hidden="true"
                className="text-muted-foreground size-3.5"
              />
            </button>
          ))}
        </div>
      )}
    </div>
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
