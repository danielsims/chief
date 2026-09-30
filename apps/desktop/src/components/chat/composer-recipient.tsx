import { Check, ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@chief/ui/components/dropdown-menu";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import { AgentAvatar } from "../agent-avatar";

export interface ComposerRecipientOption {
  id: WorkspaceAgentId;
  name: string;
}

/** Who a new message goes to, and the agents it could go to instead. */
export function ComposerRecipient({
  options,
  value,
  onChange,
}: {
  options: ComposerRecipientOption[];
  value: WorkspaceAgentId;
  onChange: (value: WorkspaceAgentId) => void;
}) {
  const selected = options.find((option) => option.id === value) ?? options[0];
  if (!selected) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Message ${selected.name}`}
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex h-7 items-center gap-1.5 rounded-md pr-1.5 pl-1 text-xs transition-colors"
        >
          <AgentAvatar
            agentId={selected.id}
            label={selected.name}
            className="size-5"
          />
          {selected.name}
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" sideOffset={6}>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onSelect={() => onChange(option.id)}
            className="h-9 gap-2"
          >
            <AgentAvatar
              agentId={option.id}
              label={option.name}
              className="size-5"
            />
            <span className="flex-1">{option.name}</span>
            {option.id === selected.id ? (
              <Check aria-hidden="true" className="size-3.5" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
