import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";

import type {
  PairedMachine,
  WebMachineGrant,
  WebMachinePolicy,
} from "@chief/relay-contracts";
import { agentIdSchema, webMachineRateLimits } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chief/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@chief/ui/components/dropdown-menu";
import { Switch } from "@chief/ui/components/switch";
import { cn } from "@chief/ui/lib/utils";

import type { DatabasePersonOption } from "./databases/database-model";
import { useAuth } from "../lib/auth/auth-context";
import { RELAY_URL } from "../lib/config";
import { parseRelayError } from "../lib/relay-runtime-errors";
import { useRelaySession } from "../lib/relay-session";
import {
  clearWebMachineVisits,
  setWebMachinePolicy,
  useWebMachinePolicy,
  useWebMachineVisits,
} from "../lib/web-machine";
import { relativeActivityTime } from "./chat/relative-activity-time";
import { PersonAvatar } from "./databases/database-cells";
import { usePeople } from "./databases/use-database";
import { UserAvatar } from "./user-avatar";

const audiences = [
  ["mine", "Only my agents"],
  ["workspace", "Everyone in this workspace"],
  ["selected", "Selected people"],
] as const;

/** Lets this computer's connection be used by the workspace's agents. */
export function LendMachineCard({ workspaceId }: { workspaceId: string }) {
  const policy = useWebMachinePolicy(workspaceId);
  const people = usePeople();
  const { user } = useAuth();
  const save = (next: WebMachinePolicy | null) =>
    setWebMachinePolicy(workspaceId, next);
  const grants = policy?.allow === "selected" ? policy.grants : [];
  const members = people.filter(
    (person) => person.kind === "user" && person.id !== user?.id,
  );
  const agents = people.filter((person) => person.kind === "agent");
  const setGrant = (userId: string, grant: WebMachineGrant | null) =>
    save({
      allow: "selected",
      grants: [
        ...grants.filter((other) => other.userId !== userId),
        ...(grant ? [grant] : []),
      ],
    });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-6 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>This computer</CardTitle>
          <CardDescription className="max-w-xl leading-6">
            Agents can browse from this computer's internet connection while
            it's awake. Sites see your IP address.
          </CardDescription>
        </div>
        <Switch
          aria-label="Lend this computer's connection"
          checked={policy !== null}
          onCheckedChange={(on) => save(on ? { allow: "mine" } : null)}
        />
      </CardHeader>
      {policy ? (
        <CardContent className="space-y-4">
          <ul className="divide-border border-border divide-y overflow-hidden rounded-xl border">
            {audiences.map(([allow, label]) => (
              <li key={allow}>
                <button
                  type="button"
                  aria-pressed={policy.allow === allow}
                  onClick={() =>
                    save(
                      allow === "selected"
                        ? { allow, grants }
                        : {
                            allow: allow === "workspace" ? "workspace" : "mine",
                          },
                    )
                  }
                  className="hover:bg-muted/40 flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors"
                >
                  <span className="min-w-0 flex-1">{label}</span>
                  {policy.allow === allow ? <Check size={14} /> : null}
                </button>
              </li>
            ))}
          </ul>
          {policy.allow === "selected" ? (
            members.length ? (
              <ul className="divide-border border-border divide-y overflow-hidden rounded-xl border">
                {members.map((member) => {
                  const grant = grants.find(
                    (candidate) => candidate.userId === member.id,
                  );
                  return (
                    <li
                      key={member.id}
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      <UserAvatar
                        image={member.image}
                        name={member.name}
                        className="size-7 rounded-full"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {member.name}
                      </span>
                      {grant ? (
                        <AgentPicker
                          agents={agents}
                          grant={grant}
                          onChange={(agentIds) =>
                            setGrant(member.id, { userId: member.id, agentIds })
                          }
                        />
                      ) : null}
                      <Switch
                        aria-label={`Let ${member.name} use this computer`}
                        checked={Boolean(grant)}
                        onCheckedChange={(on) =>
                          setGrant(
                            member.id,
                            on ? { userId: member.id, agentIds: "all" } : null,
                          )
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">
                No one else is in this workspace yet.
              </p>
            )
          ) : null}
          <p className="text-muted-foreground text-xs">
            Up to {webMachineRateLimits.perMinute} pages a minute and{" "}
            {webMachineRateLimits.perHour} an hour. Your own agents can always
            use it.
          </p>
        </CardContent>
      ) : null}
    </Card>
  );
}

/** Which of a person's agents may use the computer: all, or some. */
function AgentPicker({
  agents,
  grant,
  onChange,
}: {
  agents: readonly DatabasePersonOption[];
  grant: WebMachineGrant;
  onChange: (agentIds: WebMachineGrant["agentIds"]) => void;
}) {
  const chosen = grant.agentIds === "all" ? null : grant.agentIds;
  const toggle = (id: string) => {
    const agentId = agentIdSchema.parse(id);
    const current = chosen ?? [];
    onChange(
      current.includes(agentId)
        ? current.filter((other) => other !== agentId)
        : [...current, agentId],
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          {chosen === null
            ? "All agents"
            : chosen.length === 1
              ? "1 agent"
              : `${chosen.length} agents`}
          <ChevronDown size={13} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuItem onSelect={() => onChange("all")}>
          <span className="min-w-0 flex-1">All agents</span>
          {chosen === null ? <Check size={13} /> : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {agents.map((agent) => (
          <DropdownMenuItem
            key={agent.id}
            onSelect={(event) => {
              event.preventDefault();
              toggle(agent.id);
            }}
          >
            <PersonAvatar person={agent} />
            <span className="min-w-0 flex-1 truncate">{agent.name}</span>
            {chosen?.some((id) => id === agent.id) ? <Check size={13} /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Who has used this computer and which sites, kept only on this computer.
 * Pages aren't recorded, only the site, so you can see who's using your
 * connection without reading what they read.
 */
export function MachineActivityCard({ workspaceId }: { workspaceId: string }) {
  const visits = useWebMachineVisits(workspaceId);
  const people = usePeople();
  const nameOf = (id: string | undefined) =>
    id ? people.find((person) => person.id === id) : undefined;
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-6 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Activity</CardTitle>
          <CardDescription className="max-w-xl leading-6">
            Sites agents opened through this computer. Only kept here.
          </CardDescription>
        </div>
        {visits.length ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => clearWebMachineVisits(workspaceId)}
          >
            Clear
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {visits.length ? (
          <ul className="divide-border border-border divide-y overflow-hidden rounded-xl border">
            {visits.slice(0, 50).map((visit) => {
              const agent = nameOf(visit.agentId);
              const requester = nameOf(visit.requesterUserId);
              return (
                <li
                  key={`${visit.at}-${visit.site}`}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm"
                >
                  {agent ? <PersonAvatar person={agent} /> : null}
                  <span className="min-w-0 flex-1 truncate">
                    {agent?.name ?? "An agent"}
                    {requester ? (
                      <span className="text-muted-foreground">
                        {" "}
                        for {requester.name}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "max-w-48 truncate",
                      visit.ok ? "" : "text-muted-foreground line-through",
                    )}
                  >
                    {visit.site}
                  </span>
                  <span className="text-muted-foreground w-16 shrink-0 text-right text-xs">
                    {relativeActivityTime(visit.at)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">Nothing yet.</p>
        )}
      </CardContent>
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

/**
 * Other computers lend their connection and browser too. Adding one makes a
 * single command, good for 15 minutes, that installs everything, pairs it
 * and keeps it running; a person runs it, or hands it to a coding agent.
 */
export function PairedMachinesCard({ workspaceId }: { workspaceId: string }) {
  const { client } = useRelaySession();
  const [machines, setMachines] = useState<PairedMachine[] | null>(null);
  const [pairing, setPairing] = useState<{
    command: string;
    expiresAt: number;
  } | null>(null);
  const [audience, setAudience] = useState<"humans" | "agents">("humans");
  const [error, setError] = useState<string | null>(null);
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
  const expired = pairing !== null && secondsLeft === 0;
  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-6 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Other computers</CardTitle>
          <CardDescription className="max-w-xl leading-6">
            Lend an always-on computer, like a spare Mac or a Raspberry Pi, so
            your agents can browse and fetch the web through it.
          </CardDescription>
        </div>
        {pairing ? null : (
          <Button variant="outline" onClick={() => void add()}>
            Add a computer
          </Button>
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
                  <p>On the computer you're adding, open a terminal.</p>
                </Step>
                <Step number={2}>
                  <p>
                    Run this. It installs everything, pairs the computer and
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
                  Paste this into a coding agent on the computer you're adding,
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
              <li
                key={machine.id}
                className="flex items-center gap-3 px-4 py-2.5 text-sm"
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    machine.online
                      ? "bg-emerald-500"
                      : "bg-muted-foreground/40",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{machine.name}</span>
                <span className="text-muted-foreground text-xs">
                  {machine.online ? "Online" : "Offline"}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void remove(machine.id)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : machines && !pairing ? (
          <p className="text-muted-foreground text-sm">
            No other computers yet.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
