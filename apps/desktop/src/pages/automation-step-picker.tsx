import type { ReactNode } from "react";
import { useState } from "react";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  OctagonX,
  Plug,
  Plus,
  Split,
} from "lucide-react";

import type { AgentPluginSummary } from "@chief/agent-runtime/types";
import type { AutomationToolRef } from "@chief/relay-contracts";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@chief/ui/components/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import { cn } from "@chief/ui/lib/utils";

import type { SelectableAgent } from "../components/agents/agent-multiselect";
import type { StepKind } from "./automation-draft";
import type { AutomationCatalogue } from "./use-automation-catalogue";
import { AgentAvatar } from "../components/agent-avatar";
import { ChiefMark } from "../components/chief-mark";
import { ProviderLogo } from "../components/provider-logo";
import { pluginDomain } from "../lib/plugin-presentation";
import { chiefToolGroup, chiefToolLabel } from "./use-automation-catalogue";

export interface PickedStep {
  kind: StepKind;
  agentId?: string;
  tool?: AutomationToolRef & { title?: string };
}

export function AccessBadge({
  readOnly,
  className,
}: {
  readOnly: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-[4px] px-1 py-px text-[10px] leading-[14px] font-medium",
        readOnly
          ? "bg-foreground/[0.05] text-muted-foreground"
          : "bg-amber-500/12 text-amber-700 dark:text-amber-300",
        className,
      )}
    >
      {readOnly ? "Read" : "Write"}
    </span>
  );
}

function Item({
  value,
  icon,
  label,
  detail,
  trailing,
  onSelect,
}: {
  value: string;
  icon: ReactNode;
  label: string;
  detail?: string;
  trailing?: ReactNode;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={value}
      onSelect={onSelect}
      className="h-9 gap-2.5 rounded-[7px] px-2"
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px]">
        {label}
        {detail ? (
          <span className="text-muted-foreground ml-1.5 text-[12px]">
            {detail}
          </span>
        ) : null}
      </span>
      {trailing}
    </CommandItem>
  );
}

const drill = (
  <ChevronRight size={13} className="text-muted-foreground/70 shrink-0" />
);

function PluginIcon({ name, domain }: { name: string; domain?: string }) {
  return domain ? (
    <ProviderLogo domain={domain} label={name} className="size-5 rounded-md" />
  ) : (
    <span className="bg-foreground/[0.06] flex size-5 items-center justify-center rounded-md text-[10px] font-semibold">
      {name.slice(0, 1)}
    </span>
  );
}

type Page =
  | { kind: "root" }
  | { kind: "agents" }
  | { kind: "plugin"; id: string }
  | { kind: "chief"; group: string }
  | { kind: "connect" };

/** The + between steps: an agent, some logic, or any tool Chief can reach. */
export function StepPicker({
  catalogue,
  agents,
  connectable,
  onPick,
  onConnect,
  onAddServer,
  allowStop = true,
}: {
  catalogue: AutomationCatalogue;
  agents: readonly SelectableAgent[];
  /** Plugins that could be connected right from here. */
  connectable: readonly AgentPluginSummary[];
  onPick: (picked: PickedStep) => void;
  onConnect: (pluginId: string) => void;
  onAddServer: () => void;
  allowStop?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<Page>({ kind: "root" });
  const [search, setSearch] = useState("");
  const go = (next: Page) => {
    setPage(next);
    setSearch("");
  };
  const close = () => {
    setOpen(false);
    go({ kind: "root" });
  };
  const pick = (picked: PickedStep) => {
    close();
    onPick(picked);
  };
  const groups = new Map<string, AutomationCatalogue["chief"]>();
  for (const tool of catalogue.chief) {
    const group = chiefToolGroup(tool.name);
    groups.set(group, [...(groups.get(group) ?? []), tool]);
  }
  const flat = page.kind === "root" && search.trim() !== "";

  const agentItems = agents.map((agent) => (
    <Item
      key={agent.id}
      value={`agent ${agent.name} ${agent.role ?? ""} ${agent.id}`}
      icon={
        <AgentAvatar agentId={agent.id} label={agent.name} className="size-5" />
      }
      label={agent.name}
      detail={agent.role}
      onSelect={() => pick({ kind: "agent", agentId: agent.id })}
    />
  ));
  const pluginToolItems = (plugin: AutomationCatalogue["plugins"][number]) =>
    plugin.tools.map((tool) => (
      <Item
        key={`${plugin.id}:${tool.name}`}
        value={`${plugin.name} ${tool.title ?? ""} ${tool.name} ${tool.description.slice(0, 120)}`}
        icon={<PluginIcon name={plugin.name} domain={plugin.domain} />}
        label={tool.title ?? tool.name}
        detail={flat ? plugin.name : undefined}
        trailing={<AccessBadge readOnly={tool.readOnly} />}
        onSelect={() =>
          pick({
            kind: "tool",
            tool: {
              source: "plugin",
              connectionId: plugin.id,
              name: tool.name,
              readOnly: tool.readOnly,
              title: tool.title ?? tool.name,
            },
          })
        }
      />
    ));
  const chiefToolItems = (tools: AutomationCatalogue["chief"]) =>
    tools.map((tool) => (
      <Item
        key={tool.name}
        value={`chief ${chiefToolGroup(tool.name)} ${tool.name} ${tool.title ?? ""}`}
        icon={<ChiefMark className="size-4" />}
        label={chiefToolLabel(tool)}
        detail={flat ? "Chief" : undefined}
        trailing={<AccessBadge readOnly={tool.readOnly} />}
        onSelect={() =>
          pick({
            kind: "tool",
            tool: {
              source: "chief",
              name: tool.name,
              title: chiefToolLabel(tool),
            },
          })
        }
      />
    ));
  const connectItems = connectable.map((plugin) => (
    <Item
      key={plugin.id}
      value={`connect ${plugin.name} ${plugin.category} ${plugin.id}`}
      icon={<PluginIcon name={plugin.name} domain={pluginDomain(plugin)} />}
      label={flat ? `Connect ${plugin.name}` : plugin.name}
      trailing={
        <span className="text-muted-foreground text-[11px]">Connect</span>
      }
      onSelect={() => {
        close();
        onConnect(plugin.id);
      }}
    />
  ));
  const logicItems = [
    <Item
      key="condition"
      value="condition if else branch logic"
      icon={<Split size={14} className="text-muted-foreground" />}
      label="Condition"
      detail="If / else"
      onSelect={() => pick({ kind: "condition" })}
    />,
    allowStop ? (
      <Item
        key="stop"
        value="stop end finish logic"
        icon={<OctagonX size={14} className="text-muted-foreground" />}
        label="Stop"
        detail="End the run"
        onSelect={() => pick({ kind: "stop" })}
      />
    ) : null,
  ];

  const heading =
    page.kind === "plugin"
      ? catalogue.plugins.find((plugin) => plugin.id === page.id)?.name
      : page.kind === "chief"
        ? `Chief · ${page.group}`
        : page.kind === "connect"
          ? "Connect a plugin"
          : page.kind === "agents"
            ? "Agents"
            : undefined;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Add a step"
          className="bg-background text-muted-foreground hover:text-foreground data-[state=open]:bg-foreground data-[state=open]:text-background relative z-10 flex size-5 items-center justify-center rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.06),inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_16%,transparent)] transition-[color,background-color,transform] hover:scale-110 data-[state=open]:scale-110"
        >
          <Plus size={12} strokeWidth={2.4} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={6}
        className="w-[320px] overflow-hidden rounded-xl p-0"
      >
        <Command className="rounded-xl" loop>
          {heading ? (
            <button
              type="button"
              onClick={() => go({ kind: "root" })}
              className="text-muted-foreground hover:text-foreground flex h-8 w-full items-center gap-1 border-b border-black/[0.055] px-2 text-[11px] font-medium dark:border-white/[0.06]"
            >
              <ChevronLeft size={13} />
              {heading}
            </button>
          ) : null}
          <CommandInput
            value={search}
            onValueChange={setSearch}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !search && page.kind !== "root")
                go({ kind: "root" });
            }}
            placeholder={
              page.kind === "root"
                ? "Search agents, tools and plugins…"
                : "Search…"
            }
            className="h-10 text-[13px]"
          />
          <CommandList className="max-h-[340px] p-1">
            <CommandEmpty className="text-muted-foreground py-6 text-center text-xs">
              Nothing matches.
            </CommandEmpty>
            {page.kind === "agents" ? (
              agentItems
            ) : page.kind === "plugin" ? (
              catalogue.plugins
                .filter((plugin) => plugin.id === page.id)
                .flatMap(pluginToolItems)
            ) : page.kind === "chief" ? (
              chiefToolItems(groups.get(page.group) ?? [])
            ) : page.kind === "connect" ? (
              <>
                {connectItems}
                <Item
                  value="custom mcp server url add"
                  icon={<Plus size={14} className="text-muted-foreground" />}
                  label="Add a custom MCP server"
                  onSelect={() => {
                    close();
                    onAddServer();
                  }}
                />
              </>
            ) : flat ? (
              <>
                <CommandGroup heading="Agents">{agentItems}</CommandGroup>
                <CommandGroup heading="Logic">{logicItems}</CommandGroup>
                {catalogue.plugins.map((plugin) => (
                  <CommandGroup key={plugin.id} heading={plugin.name}>
                    {pluginToolItems(plugin)}
                  </CommandGroup>
                ))}
                <CommandGroup heading="Chief">
                  {chiefToolItems(catalogue.chief)}
                </CommandGroup>
                <CommandGroup heading="Connect">{connectItems}</CommandGroup>
              </>
            ) : (
              <>
                <CommandGroup heading="Steps">
                  {agents.length ? (
                    <Item
                      value="agent agents"
                      icon={<Bot size={14} className="text-muted-foreground" />}
                      label="Agent"
                      trailing={
                        <>
                          <span className="flex -space-x-1">
                            {agents.slice(0, 4).map((agent) => (
                              <AgentAvatar
                                key={agent.id}
                                agentId={agent.id}
                                label={agent.name}
                                className="ring-popover size-4 rounded-full ring-2"
                              />
                            ))}
                          </span>
                          {drill}
                        </>
                      }
                      onSelect={() => go({ kind: "agents" })}
                    />
                  ) : null}
                  {logicItems}
                </CommandGroup>
                <CommandGroup heading="Plugins">
                  {catalogue.plugins.map((plugin) => (
                    <Item
                      key={plugin.id}
                      value={`plugin ${plugin.name}`}
                      icon={
                        <PluginIcon name={plugin.name} domain={plugin.domain} />
                      }
                      label={plugin.name}
                      detail={`${plugin.tools.length} ${plugin.tools.length === 1 ? "tool" : "tools"}`}
                      trailing={drill}
                      onSelect={() => go({ kind: "plugin", id: plugin.id })}
                    />
                  ))}
                  <Item
                    value="connect a plugin add"
                    icon={<Plug size={14} className="text-muted-foreground" />}
                    label="Connect a plugin"
                    trailing={drill}
                    onSelect={() => go({ kind: "connect" })}
                  />
                </CommandGroup>
                {groups.size ? (
                  <CommandGroup heading="Chief">
                    {[...groups].map(([group, tools]) => (
                      <Item
                        key={group}
                        value={`chief ${group}`}
                        icon={<ChiefMark className="size-4" />}
                        label={group}
                        detail={`${tools.length} ${tools.length === 1 ? "tool" : "tools"}`}
                        trailing={drill}
                        onSelect={() => go({ kind: "chief", group })}
                      />
                    ))}
                  </CommandGroup>
                ) : null}
              </>
            )}
            {catalogue.error ? (
              <p className="text-muted-foreground px-2 py-2 text-[11px] leading-4">
                {catalogue.error}
              </p>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
