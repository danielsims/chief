import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";

import type {
  MachineActivityEntry,
  PairedMachine,
} from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chief/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { Switch } from "@chief/ui/components/switch";
import { cn } from "@chief/ui/lib/utils";

import { RELAY_URL } from "../lib/config";
import { parseRelayError } from "../lib/relay-runtime-errors";
import { useRelaySession } from "../lib/relay-session";
import { relativeActivityTime } from "./chat/relative-activity-time";
import { PersonAvatar } from "./databases/database-cells";
import { usePeople } from "./databases/use-database";

/**
 * Machines lend their connection and browser to the workspace's agents.
 * Adding one makes a single command, good for 15 minutes, that installs
 * everything, pairs it and keeps it running; a person runs it, or hands it
 * to a coding agent. Each machine opens to its own controls and activity.
 */
export function MachinesCard({ workspaceId }: { workspaceId: string }) {
  const { client } = useRelaySession();
  const [machines, setMachines] = useState<PairedMachine[] | null>(null);
  const [pairing, setPairing] = useState<{
    command: string;
    expiresAt: number;
  } | null>(null);
  const [audience, setAudience] = useState<"humans" | "agents">("humans");
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PairedMachine | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const activity = usePairedActivity();
  const opened = machines?.find((machine) => machine.id === openId) ?? null;
  const secondsLeft = useCountdown(pairing?.expiresAt ?? null);
  const refresh = useCallback(() => {
    if (!client) return;
    void client.listPairedMachines().then(setMachines, () => setMachines([]));
  }, [client]);
  // Read on open, then whenever the relay says a computer connected,
  // disconnected, was paired or removed, and after a reconnect: never polled.
  useEffect(() => {
    if (!client) return;
    refresh();
    let stopped = false;
    let subscription: { close: () => void } | null = null;
    void client
      .subscribeWorkspace({
        conversationIds: [],
        onEvent: () => undefined,
        onMachinesChanged: refresh,
        onResubscribed: refresh,
      })
      .then((opened) => {
        if (stopped) opened.close();
        else subscription = opened;
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
      subscription?.close();
    };
  }, [client, refresh]);

  const add = async () => {
    if (!client) return;
    setError(null);
    try {
      const created = await client.createMachinePairing();
      // One token carries everything the machine needs to find this
      // workspace, so the whole setup is a single line to paste.
      const token = btoa(
        JSON.stringify({ relay: RELAY_URL, workspaceId, code: created.code }),
      )
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/u, "");
      setPairing({
        command: setupCommand(token),
        expiresAt: Date.now() + created.expiresInSeconds * 1000,
      });
    } catch (cause) {
      setError(parseRelayError(cause).message);
    }
  };
  const remove = async (machineId: string) => {
    if (!client) return;
    await client.removePairedMachine(machineId).catch((cause: unknown) => {
      setError(parseRelayError(cause).message);
    });
    refresh();
  };
  const setEnabled = async (machineId: string, enabled: boolean) => {
    if (!client) return;
    setError(null);
    setMachines(
      (current) =>
        current?.map((machine) =>
          machine.id === machineId ? { ...machine, enabled } : machine,
        ) ?? null,
    );
    await client
      .setPairedMachineEnabled(machineId, enabled)
      .catch((cause: unknown) => {
        setError(parseRelayError(cause).message);
        refresh();
      });
  };
  const expired = pairing !== null && secondsLeft === 0;
  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Machines</CardTitle>
        <CardDescription>
          Always-on computers your agents browse and fetch the web through.
        </CardDescription>
        {pairing ? null : (
          <CardAction>
            <Button variant="outline" onClick={() => void add()}>
              Add a machine
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
        {pairing ? (
          <div className="space-y-4">
            <div className="flex items-center gap-5">
              <nav
                aria-label="Who's setting it up"
                className="flex flex-1 items-center gap-5"
                role="tablist"
              >
                {(
                  [
                    ["humans", "For humans"],
                    ["agents", "For agents"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={audience === value}
                    onClick={() => setAudience(value)}
                    className={cn(
                      "text-muted-foreground hover:text-foreground relative flex h-8 items-center text-xs font-medium transition-colors",
                      audience === value && "text-foreground",
                    )}
                  >
                    {label}
                    {audience === value ? (
                      <span className="bg-foreground absolute right-0 bottom-0 left-0 h-px" />
                    ) : null}
                  </button>
                ))}
              </nav>
              <span
                className={cn(
                  "text-xs tabular-nums",
                  expired
                    ? "text-destructive"
                    : secondsLeft < 120
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground",
                )}
              >
                {expired ? "Expired" : `Expires in ${countdown}`}
              </span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setPairing(null)}
              >
                Done
              </Button>
            </div>
            {expired ? (
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground flex-1">
                  This code has expired. Make a new one to keep going.
                </span>
                <Button size="sm" variant="outline" onClick={() => void add()}>
                  New code
                </Button>
              </div>
            ) : audience === "humans" ? (
              <ol className="space-y-4">
                <Step number={1}>
                  <p>On the machine you're adding, open a terminal.</p>
                </Step>
                <Step number={2}>
                  <p>
                    Run this. It installs everything, pairs the machine and
                    keeps it running, even after a restart.
                  </p>
                  <CopyField label="Copy command" text={pairing.command} />
                </Step>
                <Step number={3}>
                  <p className="text-muted-foreground">
                    It appears below as soon as it connects.
                  </p>
                </Step>
              </ol>
            ) : (
              <div className="space-y-2">
                <p className="text-sm leading-5">
                  Paste this into a coding agent on the machine you're adding,
                  such as Claude Code or Codex.
                </p>
                <CopyField
                  label="Copy prompt"
                  text={agentPrompt(pairing.command)}
                />
              </div>
            )}
          </div>
        ) : null}
        {machines?.length ? (
          <ul className="divide-border border-border divide-y overflow-hidden rounded-xl border">
            {machines.map((machine) => (
              <MachineRow
                key={machine.id}
                machine={machine}
                onOpen={() => setOpenId(machine.id)}
              />
            ))}
          </ul>
        ) : machines && !pairing ? (
          <p className="text-muted-foreground text-sm">No machines yet.</p>
        ) : null}
      </CardContent>

      <Dialog
        open={Boolean(opened)}
        onOpenChange={(open) => !open && setOpenId(null)}
      >
        {opened ? (
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{opened.name}</DialogTitle>
              <DialogDescription>{machineStatus(opened)}</DialogDescription>
            </DialogHeader>
            <label className="flex items-center gap-3 text-sm">
              <span className="flex-1">Let agents use this machine</span>
              <Switch
                checked={opened.enabled}
                onCheckedChange={(enabled) =>
                  void setEnabled(opened.id, enabled)
                }
              />
            </label>
            <MachineActivity
              entries={activity.filter(
                (entry) => entry.machineId === opened.id,
              )}
            />
            <DialogFooter>
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive mr-auto"
                onClick={() => {
                  setRemoving(opened);
                  setOpenId(null);
                }}
              >
                Remove machine
              </Button>
              <Button variant="outline" onClick={() => setOpenId(null)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove machine?</DialogTitle>
            <DialogDescription>
              Agents will stop using {removing?.name ?? "this machine"}. To use
              it again, you'll need to add it again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (removing) void remove(removing.id);
                setRemoving(null);
              }}
            >
              Remove machine
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** The one command that installs, pairs and starts a computer. */
function setupCommand(token: string) {
  return `curl -fsSL ${RELAY_URL}/install/machine | sh -s -- ${token}`;
}

/** What to paste into a coding agent on the computer being added. */
function agentPrompt(command: string) {
  return `Connect this computer to my Chief workspace. Run this command in a terminal here (it may ask for my password to install), then show me what it prints at the end:\n\n${command}`;
}

function useCountdown(until: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    // A local clock for the label; it makes no requests.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

function CopyField({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-muted flex items-start gap-2 rounded-lg py-2 pr-1.5 pl-3">
      <code className="min-w-0 flex-1 font-mono text-xs leading-5 break-all whitespace-pre-wrap">
        {text}
      </code>
      <Button
        size="xs"
        variant="ghost"
        aria-label={label}
        onClick={() =>
          void navigator.clipboard.writeText(text).then(() => setCopied(true))
        }
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function Step({ number, children }: { number: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium tabular-nums">
        {number}
      </span>
      <div className="min-w-0 flex-1 space-y-2 pt-px text-sm leading-5">
        {children}
      </div>
    </li>
  );
}

function machineStatus(machine: PairedMachine) {
  if (!machine.enabled) return "Paused. Agents won't use it.";
  return machine.online ? "Online" : "Offline";
}

/** One machine in the list; it opens to the machine's controls and activity. */
function MachineRow({
  machine,
  onOpen,
}: {
  machine: PairedMachine;
  onOpen: () => void;
}) {
  const live = machine.enabled && machine.online;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="hover:bg-muted/40 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {machine.name}
          </span>
          <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                live ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
            />
            {machineStatus(machine)}
          </span>
        </span>
        <ChevronRight size={14} className="text-muted-foreground" />
      </button>
    </li>
  );
}

/**
 * What agents opened through the workspace's paired machines. Read on open,
 * then whenever a machine serves a page, and after a reconnect: never polled.
 */
function usePairedActivity() {
  const { client } = useRelaySession();
  const [entries, setEntries] = useState<MachineActivityEntry[]>([]);
  const refresh = useCallback(() => {
    if (!client) return;
    void client.listMachineActivity().then(setEntries, () => setEntries([]));
  }, [client]);
  useEffect(() => {
    if (!client) return;
    refresh();
    let stopped = false;
    let subscription: { close: () => void } | null = null;
    void client
      .subscribeWorkspace({
        conversationIds: [],
        onEvent: () => undefined,
        onMachinesActivity: refresh,
        onResubscribed: refresh,
      })
      .then((opened) => {
        if (stopped) opened.close();
        else subscription = opened;
      })
      .catch(() => undefined);
    return () => {
      stopped = true;
      subscription?.close();
    };
  }, [client, refresh]);
  return entries;
}

export interface MachineActivityItem {
  at: number;
  agentId?: string;
  requesterUserId?: string;
  site: string;
  ok: boolean;
}

/** A machine's recent sites: which agent, for whom, and when. */
export function MachineActivity({
  entries,
}: {
  entries: readonly MachineActivityItem[];
}) {
  const people = usePeople();
  const nameOf = (id: string | undefined) =>
    id ? people.find((person) => person.id === id) : undefined;
  const recent = [...entries].sort((a, b) => b.at - a.at).slice(0, 50);
  return (
    <section className="space-y-2">
      <h3 className="text-muted-foreground text-xs font-medium">Activity</h3>
      {recent.length ? (
        <ul className="divide-border border-border max-h-80 divide-y overflow-y-auto rounded-xl border">
          {recent.map((visit) => {
            const agent = nameOf(visit.agentId);
            const requester = nameOf(visit.requesterUserId);
            return (
              <li
                key={`${visit.at}-${visit.site}`}
                className="flex items-center gap-3 px-3 py-2 text-sm"
              >
                {agent ? <PersonAvatar person={agent} /> : null}
                <span className="min-w-0 flex-1 truncate">
                  <span
                    className={cn(
                      visit.ok ? "" : "text-muted-foreground line-through",
                    )}
                  >
                    {visit.site}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {agent?.name ?? "An agent"}
                    {requester ? ` for ${requester.name}` : ""}
                  </span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {relativeActivityTime(visit.at)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">Nothing yet.</p>
      )}
    </section>
  );
}
