import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import type { WebMachineGrant, WebMachinePolicy } from "@chief/relay-contracts";
import { agentIdSchema, webMachineRateLimits } from "@chief/relay-contracts";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@chief/ui/components/dropdown-menu";
import { Switch } from "@chief/ui/components/switch";

import type { DatabasePersonOption } from "./databases/database-model";
import { useAuth } from "../lib/auth/auth-context";
import {
  clearWebMachineVisits,
  setWebMachinePolicy,
  useWebMachinePolicy,
  useWebMachineVisits,
} from "../lib/web-machine";
import { PersonAvatar } from "./databases/database-cells";
import { usePeople } from "./databases/use-database";
import { MachineActivity } from "./machines-card";
import { UserAvatar } from "./user-avatar";

const audiences = [
  ["mine", "Only my agents"],
  ["workspace", "Everyone in this workspace"],
  ["selected", "Selected people"],
] as const;

/** Lets this computer's connection be used by the workspace's agents. */
export function LendMachineCard({ workspaceId }: { workspaceId: string }) {
  const policy = useWebMachinePolicy(workspaceId);
  const visits = useWebMachineVisits(workspaceId);
  const [showingActivity, setShowingActivity] = useState(false);
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
      <CardHeader>
        <CardTitle>This computer</CardTitle>
        <CardDescription>
          Agents can browse from this computer's internet connection while it's
          awake. Sites see your IP address.
        </CardDescription>
        <CardAction>
          <Switch
            aria-label="Lend this computer's connection"
            checked={policy !== null}
            onCheckedChange={(on) => save(on ? { allow: "mine" } : null)}
          />
        </CardAction>
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
          <div className="flex items-center gap-3">
            <p className="text-muted-foreground flex-1 text-xs">
              Up to {webMachineRateLimits.perMinute} pages a minute and{" "}
              {webMachineRateLimits.perHour} an hour. Your own agents can always
              use it.
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowingActivity(true)}
            >
              View activity
            </Button>
          </div>
        </CardContent>
      ) : null}
      <Dialog open={showingActivity} onOpenChange={setShowingActivity}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>This computer</DialogTitle>
            <DialogDescription>
              Kept only on this computer: the site, never the page.
            </DialogDescription>
          </DialogHeader>
          <MachineActivity entries={visits} />
          <DialogFooter>
            {visits.length ? (
              <Button
                variant="ghost"
                className="mr-auto"
                onClick={() => clearWebMachineVisits(workspaceId)}
              >
                Clear
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setShowingActivity(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
