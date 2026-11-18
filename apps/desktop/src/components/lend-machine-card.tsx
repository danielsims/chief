import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Copy, X } from "lucide-react";

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
import { insetBandClass, insetCardClass } from "./inset-card";
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

/**
 * Machines without the app pair by running one command
 * copied from here. Each has its own key, which can only lend that machine's
 * connection, and removing it here cuts it off at once.
 */
/**
 * What a coding agent on the other computer needs to set it up: install,
 * pair with this one-time command, turn on its browser and keep it running.
 */
function machineSetupPrompt(pairCommand: string) {
  return `Set up this computer as a Chief machine for my workspace, so my agents can browse and fetch the web through it.

1. Install the Chief machine command: curl -fsSL ${RELAY_URL}/install/machine | sh
2. Pair it (this works once, within 15 minutes): ${pairCommand}
3. Let my agents use its browser: install Google Chrome (or Chromium) and Cloudflare's cloudflared, then run chief-machine browser enable --chrome <full path to Chrome>.
4. Keep it running: start chief-machine serve now and on every boot, as a user service (systemd on Linux, launchd on macOS) that restarts if it stops.

When you're done, show me the output of chief-machine status.`;
}

export function PairedMachinesCard({ workspaceId }: { workspaceId: string }) {
  const { client } = useRelaySession();
  const [machines, setMachines] = useState<PairedMachine[] | null>(null);
  const [command, setCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    if (!client) return;
    void client.listPairedMachines().then(setMachines, () => setMachines([]));
  }, [client]);
  useEffect(() => {
    refresh();
    // Paired machines come and go while this is open, so it keeps current.
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const add = async () => {
    if (!client) return;
    setError(null);
    try {
      const pairing = await client.createMachinePairing();
      // One token carries everything the machine needs to find this
      // workspace, so it's a single line to paste over SSH.
      const token = btoa(
        JSON.stringify({ relay: RELAY_URL, workspaceId, code: pairing.code }),
      )
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/u, "");
      setCommand(`chief-machine pair ${token}`);
      setCopied(false);
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
        <Button variant="outline" onClick={() => void add()}>
          Add a computer
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
        {command ? (
          <section
            aria-label="Setup prompt"
            className={cn(insetBandClass, "block w-full text-left")}
          >
            <span className="text-muted-foreground flex h-8 items-center gap-1 pr-1 pl-2.5 text-[12px]">
              <span className="min-w-0 flex-1 truncate">Setup prompt</span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(machineSetupPrompt(command))
                    .then(() => setCopied(true))
                }
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Dismiss"
                onClick={() => setCommand(null)}
              >
                <X size={12} />
              </Button>
            </span>
            <pre
              className={cn(
                insetCardClass,
                "max-h-64 overflow-auto font-sans text-[12.5px] leading-5 whitespace-pre-wrap",
              )}
            >
              {machineSetupPrompt(command)}
            </pre>
            <p className="text-muted-foreground px-2.5 pt-1.5 pb-1 text-[12px]">
              Paste it into a coding agent on that computer, such as Claude Code
              or Codex. The code works once, for 15 minutes.
            </p>
          </section>
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
                  {machine.online ? "Serving" : "Offline"}
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
        ) : machines && !command ? (
          <p className="text-muted-foreground text-sm">None yet.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
