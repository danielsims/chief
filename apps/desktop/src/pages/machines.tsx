import { useState } from "react";
import { Check, Cpu, RefreshCw, X } from "lucide-react";
import { createPortal } from "react-dom";

import type { Machine } from "@chief/relay-contracts";
import { defaultAgents } from "@chief/agent-runtime/agent-roster";
import { agentIdSchema } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import { PageTitle } from "../components/page-title";
import { useRelayMachines } from "../lib/relay-machines";

const machineCapabilities = [
  ["browser", "Browser"],
  ["screen", "Screen"],
  ["files", "Files"],
  ["git", "Git"],
  ["shell", "Shell"],
] as const;

function MachineCard({
  machine,
  onSelect,
}: {
  machine: Machine;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="border-border/70 bg-card hover:bg-muted/35 flex min-h-28 w-full items-start rounded-2xl border p-4 text-left transition-colors"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[14px] font-medium">
          <span className="truncate">{machine.name}</span>
          <span
            className={cn(
              "size-1.5 rounded-full",
              machine.status === "online"
                ? "bg-emerald-400"
                : "bg-muted-foreground/45",
            )}
          />
        </span>
        <span className="text-muted-foreground mt-1 block text-[12px] leading-5">
          {machine.kind === "cloudflare"
            ? "Cloudflare Computer"
            : "Self-hosted"}
          {machine.agentIds.length
            ? ` · ${machine.agentIds.length} agent${machine.agentIds.length === 1 ? "" : "s"}`
            : " · No agents"}
        </span>
        {machine.endpoint ? (
          <span className="text-muted-foreground mt-1 block truncate text-[12px] leading-4">
            {machine.endpoint}
          </span>
        ) : null}
        <span className="text-muted-foreground mt-2 block truncate text-[12px] leading-4">
          {machine.capabilities.join(" · ")}
        </span>
      </span>
    </button>
  );
}

function MachineEditor({
  machine,
  busy,
  onClose,
  onSave,
}: {
  machine: Machine;
  busy: boolean;
  onClose: () => void;
  onSave: (machine: Machine) => void;
}) {
  const [draft, setDraft] = useState(machine);
  const toggleAgent = (agentId: Machine["agentIds"][number]) =>
    setDraft((current) => ({
      ...current,
      agentIds: current.agentIds.includes(agentId)
        ? current.agentIds.filter((id) => id !== agentId)
        : [...current.agentIds, agentId],
    }));
  const toggleCapability = (capability: Machine["capabilities"][number]) =>
    setDraft((current) => ({
      ...current,
      capabilities: current.capabilities.includes(capability)
        ? current.capabilities.filter((item) => item !== capability)
        : [...current.capabilities, capability],
    }));
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm">
      <section className="bg-card border-border/70 w-full max-w-lg rounded-2xl border shadow-2xl">
        <header className="flex items-start justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="text-[18px] font-medium tracking-[-0.02em]">
              {machine.name}
            </h2>
            <p className="text-muted-foreground mt-1 text-[13px]">
              Choose which agents can use this machine.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X size={15} />
          </Button>
        </header>
        <div className="border-border/70 border-y px-5 py-4">
          <p className="mb-2 text-[13px] font-medium">Agents</p>
          <div className="grid grid-cols-2 gap-2">
            {defaultAgents.map((agent) => {
              const agentId = agentIdSchema.parse(agent.id);
              const selected = draft.agentIds.includes(agentId);
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => toggleAgent(agentId)}
                  className={cn(
                    "border-border/70 flex h-10 items-center gap-2 rounded-xl border px-3 text-[13px]",
                    selected && "bg-muted border-foreground/40",
                  )}
                >
                  <span className="truncate">{agent.name}</span>
                  {selected ? <Check className="ml-auto" size={13} /> : null}
                </button>
              );
            })}
          </div>
          <p className="mt-5 mb-2 text-[13px] font-medium">Access</p>
          <div className="flex flex-wrap gap-2">
            {machineCapabilities.map(([capability, label]) => {
              const selected = draft.capabilities.includes(capability);
              return (
                <button
                  key={capability}
                  type="button"
                  onClick={() => toggleCapability(capability)}
                  className={cn(
                    "border-border/70 flex h-9 items-center gap-2 rounded-xl border px-3 text-[13px]",
                    selected && "bg-muted border-foreground/40",
                  )}
                >
                  {label}
                  {selected ? <Check size={12} /> : null}
                </button>
              );
            })}
          </div>
        </div>
        <footer className="flex items-center gap-2 px-5 py-4">
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button size="sm" loading={busy} onClick={() => onSave(draft)}>
            Save
          </Button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export function MachinesPage() {
  const machines = useRelayMachines();
  const [selected, setSelected] = useState<Machine | null>(null);
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border">
      <header className="border-border/60 flex shrink-0 items-start gap-4 border-b px-6 py-5">
        <div className="min-w-0 flex-1">
          <PageTitle>Machines</PageTitle>
          <p className="text-muted-foreground mt-1 text-[13px] leading-5">
            Computers your agents can work on.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void machines.refresh()}
        >
          <RefreshCw size={13} />
          Refresh
        </Button>
      </header>
      <div className="px-6 py-6">
        {machines.error ? (
          <p className="text-destructive mx-auto mb-4 max-w-6xl text-[13px]">
            {machines.error}
          </p>
        ) : null}
        {machines.loading ? (
          <div className="mx-auto grid max-w-6xl gap-2 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="bg-muted h-28 animate-pulse rounded-2xl"
              />
            ))}
          </div>
        ) : machines.machines.length ? (
          <div className="mx-auto grid max-w-6xl gap-2 md:grid-cols-2 xl:grid-cols-3">
            {machines.machines.map((machine) => (
              <MachineCard
                key={machine.id}
                machine={machine}
                onSelect={() => setSelected(machine)}
              />
            ))}
          </div>
        ) : (
          <div className="bg-sidebar border-border/60 mx-auto flex min-h-64 max-w-6xl flex-col items-center justify-center rounded-2xl border px-8 text-center">
            <Cpu size={22} strokeWidth={1.5} />
            <p className="mt-3 text-[18px] font-medium tracking-[-0.025em]">
              No machines connected
            </p>
            <p className="text-muted-foreground mt-1 text-[13px]">
              Connect a managed computer or one of your own.
            </p>
          </div>
        )}
      </div>
      {selected ? (
        <MachineEditor
          machine={selected}
          busy={machines.busy}
          onClose={() => setSelected(null)}
          onSave={(draft) =>
            void machines
              .update(draft.id, {
                name: draft.name,
                capabilities: draft.capabilities,
                agentIds: draft.agentIds,
              })
              .then(() => setSelected(null))
          }
        />
      ) : null}
    </section>
  );
}
