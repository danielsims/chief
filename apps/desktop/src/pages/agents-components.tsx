import { useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { useNavigate } from "react-router";

import type {
  AgentDefinition,
  AgentPreference,
} from "@chief/agent-runtime/types";
import { defaultAgents } from "@chief/agent-runtime/agent-roster";
import { Button } from "@chief/ui/components/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@chief/ui/components/select";
import { cn } from "@chief/ui/lib/utils";

import type { PlaybookCategory } from "../lib/playbook-types";
import { AgentAvatar as ChiefAgentAvatar } from "../components/agent-avatar";
import { IntegrationAvatarStack } from "../components/integrations/integration-avatar-stack";
import { PlaybookDocument } from "../components/playbooks/playbook-document";
import { createChat } from "../lib/chat-log";
import { PLAYBOOK_CATEGORIES, PLAYBOOKS } from "../lib/playbook-catalog";
import {
  playbookRunPrompt,
  playbookSetupPrompt,
} from "../lib/playbook-prompts";

/**
 * Agents a registry backend will offer later. Shown here so the page reads
 * as a registry from day one; install mechanics come with the registry PRD.
 */
type AgentOverride = AgentPreference;

export const availableAgents = [
  {
    id: "seo",
    name: "SEO specialist",
    role: "Search & site content",
    description:
      "Audits your site, finds keyword gaps and drafts pages that can rank.",
  },
  {
    id: "email",
    name: "Email specialist",
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

function isPlaybookCategory(value: string): value is PlaybookCategory | "All" {
  return ["All", ...PLAYBOOK_CATEGORIES].includes(value);
}

export function AgentAvatar({
  name,
  enabled = true,
  size = "md",
}: {
  name: string;
  enabled?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  return (
    <span
      className={cn(
        "relative flex shrink-0",
        size === "sm" && "size-8",
        size === "md" && "size-10",
        size === "lg" && "size-12",
        size === "xl" && "size-[72px]",
      )}
    >
      <ChiefAgentAvatar label={name} className="size-full" />
      <span
        className={cn(
          "border-background absolute right-0 bottom-0 size-3 rounded-full border-2",
          enabled ? "bg-emerald-500" : "bg-muted-foreground/35",
        )}
      />
    </span>
  );
}

export function TeamAgentCard({
  agent,
  override,
  selected,
  onSelect,
}: {
  agent: AgentDefinition;
  override: AgentOverride | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const enabled = override?.enabled ?? true;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "bg-background hover:bg-muted/35 group flex flex-col rounded-2xl border border-black/[0.1] px-5 py-4 text-left transition-[background-color,border-color,box-shadow] dark:border-white/[0.1]",
        selected && "bg-accent/40 border-foreground/15 shadow-sm",
      )}
    >
      <span className="flex w-full flex-col">
        <span className="flex items-start gap-3.5">
          <AgentAvatar name={agent.name} enabled={enabled} size="lg" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="block truncate text-sm font-semibold">
                {agent.name}
              </span>
            </span>
            <span className="text-muted-foreground mt-0.5 block truncate text-[12px] leading-4">
              {agent.subagents?.length
                ? `${agent.role} · ${agent.subagents.length} subagent${agent.subagents.length === 1 ? "" : "s"}`
                : agent.role}
            </span>
          </span>
          <ChevronRight
            size={13}
            className="text-muted-foreground/60 mt-1 shrink-0 transition-transform group-hover:translate-x-0.5"
          />
        </span>
        <span className="text-muted-foreground mt-4 line-clamp-2 text-[12px] leading-5">
          {agent.description}
        </span>
      </span>
    </button>
  );
}

export function AvailableAgentDetail({
  agent,
  onClose,
}: {
  agent: (typeof availableAgents)[number];
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-full flex-col p-5">
      <div className="flex items-start justify-between gap-4 pb-5 shadow-[inset_0_-1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
        <div className="flex items-center gap-3.5">
          <AgentAvatar name={agent.name} enabled={false} size="lg" />
          <div>
            <h3 className="text-lg font-semibold tracking-[-0.025em]">
              {agent.name}
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs">{agent.role}</p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close agent details"
          onClick={onClose}
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 items-center justify-center rounded-lg transition-colors"
        >
          <X size={13} />
        </button>
      </div>
      <div className="py-5">
        <p className="text-muted-foreground text-sm leading-6">
          {agent.description}
        </p>
        <div className="bg-foreground/[0.025] mt-5 rounded-xl p-4 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%,transparent)]">
          <p className="text-xs font-semibold">Available soon</p>
          <p className="text-muted-foreground mt-1 text-xs leading-5">
            Review its access and playbooks here before adding it to your team.
          </p>
        </div>
      </div>
      <Button className="mt-auto" disabled>
        Add to team
      </Button>
    </div>
  );
}

export function PlaybooksCatalogue() {
  const navigate = useNavigate();
  const [category, setCategory] = useState<PlaybookCategory | "All">("All");
  const visible =
    category === "All"
      ? PLAYBOOKS
      : PLAYBOOKS.filter((playbook) => playbook.categories.includes(category));
  const [selectedId, setSelectedId] = useState(
    () => visible[0]?.id ?? PLAYBOOKS[0]?.id ?? "",
  );
  const selected =
    visible.find((playbook) => playbook.id === selectedId) ??
    visible[0] ??
    PLAYBOOKS[0];
  if (!selected) return null;
  const owner = defaultAgents.find((agent) => agent.id === selected.agentId);

  const selectCategory = (next: PlaybookCategory | "All") => {
    setCategory(next);
    const first =
      next === "All"
        ? PLAYBOOKS[0]
        : PLAYBOOKS.find((playbook) => playbook.categories.includes(next));
    if (first) setSelectedId(first.id);
  };

  const runNow = () => {
    const chat = createChat(selected.title);
    void navigate(
      `/conversations?chat=${chat.id}&prompt=${encodeURIComponent(`Run this playbook. Consult the ${owner?.name ?? selected.agentId} specialist.\n\n${playbookRunPrompt(selected)}`)}`,
    );
  };

  const checkSetup = () => {
    const chat = createChat(`Prepare ${selected.title}`);
    void navigate(
      `/conversations?chat=${chat.id}&prompt=${encodeURIComponent(`Prepare this playbook. Consult the setup specialist.\n\n${playbookSetupPrompt(selected)}`)}`,
    );
  };

  return (
    <div className="grid h-full min-h-[620px] grid-cols-[316px_minmax(0,1fr)] overflow-hidden">
      <aside className="bg-muted/20 flex min-h-0 flex-col border-r border-black/[0.055] dark:border-white/[0.06]">
        <div className="border-b border-black/[0.055] p-4 dark:border-white/[0.06]">
          <Select
            value={category}
            onValueChange={(value) => {
              if (isPlaybookCategory(value)) selectCategory(value);
            }}
          >
            <SelectTrigger className="bg-background h-9 w-full rounded-lg text-xs shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
              {category === "All" ? "All playbooks" : category}
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Filter playbooks</SelectLabel>
                {(["All", ...PLAYBOOK_CATEGORIES] as const).map((item) => (
                  <SelectItem key={item} value={item}>
                    {item === "All" ? "All playbooks" : item}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
          {visible.map((playbook) => (
            <button
              key={playbook.id}
              type="button"
              onClick={() => setSelectedId(playbook.id)}
              className={cn(
                "hover:bg-accent/70 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-[background-color,box-shadow]",
                selected.id === playbook.id &&
                  "bg-background shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent),0_1px_2px_rgba(0,0,0,0.025)]",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {playbook.title}
                </span>
                <span className="text-muted-foreground mt-1 block truncate text-[11px]">
                  {playbook.summary}
                </span>
              </span>
              <IntegrationAvatarStack integrations={playbook.integrations} />
            </button>
          ))}
        </div>
      </aside>

      <article className="min-h-0 min-w-0 overflow-y-auto">
        <header className="border-b border-black/[0.055] px-8 py-7 dark:border-white/[0.06]">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="text-muted-foreground text-[11px]">
                Playbook · {owner?.name ?? selected.agentId}
              </p>
              <h2 className="mt-2 text-[24px] leading-tight font-normal tracking-[-0.035em]">
                {selected.title}
              </h2>
              <p className="text-muted-foreground mt-2 max-w-2xl text-[13px] leading-5">
                {selected.summary}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={runNow}>
                Run now
              </Button>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-black/[0.05] pt-4 dark:border-white/[0.055]">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <IntegrationAvatarStack
                integrations={selected.integrations}
                max={10}
              />
              <span className="text-muted-foreground text-xs">
                {selected.integrations.map((item) => item.label).join(", ")}
              </span>
            </div>
            <button
              type="button"
              onClick={checkSetup}
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 transition-colors hover:underline"
            >
              Check setup
            </button>
          </div>
        </header>
        <PlaybookDocument playbook={selected} />
      </article>
    </div>
  );
}
