import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import type { RecurringWorkRecord } from "@chief/agent-runtime/types";
import type { Mission } from "@chief/relay-contracts";
import {
  missionCreateSchema,
  workspaceScheduleInputSchema,
} from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { Input } from "@chief/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@chief/ui/components/select";

import {
  AgentMultiselect,
  TeamAvatar,
} from "../components/agents/agent-multiselect";
import { useRelaySession } from "../lib/relay-session";
import {
  cronFromFields,
  fieldsFromCron,
  isScheduleFrequency,
} from "./schedule-editor";

export const scheduleSelectClass =
  "border-input bg-background h-10 w-full rounded-md border px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30";

function Choice({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-10 rounded-md">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent className="rounded-lg">{children}</SelectContent>
    </Select>
  );
}

export function ScheduleComposer({
  work,
  onClose,
  onSaved,
}: {
  work: RecurringWorkRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { client, snapshot } = useRelaySession();
  const channels =
    snapshot?.conversations.filter((channel) => channel.kind === "channel") ??
    [];
  const agents = (snapshot?.agents ?? [])
    .flatMap((agent) => [agent, ...agent.subagents])
    .filter(
      (agent, index, all) =>
        agent.canMessage !== false &&
        all.findIndex((item) => item.id === agent.id) === index,
    );
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [id] = useState(() => work?.id ?? crypto.randomUUID());
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState(work?.title ?? "");
  const [channelId, setChannelId] = useState(
    work?.conversationId ?? channels[0]?.id ?? "new",
  );
  const [channelName, setChannelName] = useState("");
  const [agentId, setAgentId] = useState(
    work?.agentId ??
      agents.find((agent) => agent.id === "chief")?.id ??
      agents[0]?.id ??
      "",
  );
  const [collaborators, setCollaborators] = useState<string[]>(
    work?.collaborators ?? [],
  );
  const [missionId, setMissionId] = useState(work?.missionId ?? "none");
  const [missions, setMissions] = useState<Mission[]>([]);
  const [instructions, setInstructions] = useState(work?.instructions ?? "");
  const [outcome, setOutcome] = useState(work?.expectedOutcome ?? "");
  const [constraints, setConstraints] = useState(work?.constraints ?? "");
  const [budget, setBudget] = useState(work?.maxDurationMinutes ?? 60);
  const [timezone, setTimezone] = useState(work?.timezone ?? localTimezone);
  const [mode, setMode] = useState(
    work?.triggerMode === "webhook"
      ? "webhook"
      : work?.onceAt
        ? "once"
        : "cron",
  );
  const [fields, setFields] = useState(() =>
    fieldsFromCron(work?.cron ?? "0 9 * * 1-5"),
  );
  const [once, setOnce] = useState(() => {
    if (!work?.onceAt) return "";
    const date = new Date(work.onceAt);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (client)
      void client
        .listMissions()
        .then((next) => {
          if (active) setMissions(next);
        })
        .catch(() => {
          if (active)
            setError(
              "Could not load existing missions. Reopen this dialog to try again.",
            );
        });
    return () => {
      active = false;
    };
  }, [client]);
  const patchFields = (patch: Partial<typeof fields>) =>
    setFields((current) => ({ ...current, ...patch }));
  const next = () => {
    if (
      !instructions.trim() ||
      !agentId ||
      (channelId === "new" && !channelName.trim())
    )
      return;
    setError("");
    setStep(1);
  };
  const save = async () => {
    if (!client || busy) return;
    setBusy(true);
    setError("");
    try {
      const onceAt = mode === "once" ? new Date(once).getTime() : undefined;
      if (
        onceAt !== undefined &&
        (!Number.isFinite(onceAt) || onceAt <= Date.now())
      )
        throw new Error("Choose a time in the future.");
      const conversationId = channelId === "new" ? `mission-${id}` : channelId;
      const selectedTeam = [...new Set([agentId, ...collaborators])];
      const resolvedTitle =
        title.trim() ||
        (instructions.trim().split(/\n/u)[0] ?? "").slice(0, 100);
      const input = workspaceScheduleInputSchema.parse({
        id,
        title: resolvedTitle,
        conversationId,
        agentId,
        collaborators: selectedTeam.filter((id) => id !== agentId),
        missionId:
          channelId === "new"
            ? `mission-${id}`
            : missionId === "none"
              ? undefined
              : missionId,
        instructions,
        expectedOutcome: outcome,
        constraints,
        maxDurationMinutes: budget,
        triggerMode: mode === "webhook" ? "webhook" : "cron",
        onceAt,
        timezone: mode === "once" ? localTimezone : timezone,
        cron: cronFromFields(fields),
        approvalSummary: outcome || instructions,
        proposedToolPatterns: work?.proposedToolPatterns ?? [],
        skipDates: work?.skipDates ?? [],
      });
      // Stable IDs let a retry finish a partially completed setup without creating another channel or mission.
      if (
        channelId === "new" &&
        !(await client.listChannels()).some(
          (channel) => channel.id === conversationId,
        )
      ) {
        await client.createChannel({
          conversationId,
          name: channelName.trim(),
          isPrivate: false,
        });
      }
      const members = await client.listChannelMembers(conversationId);
      const missing = selectedTeam.filter(
        (id) =>
          !members.some(
            (member) => member.kind === "agent" && member.principalId === id,
          ),
      );
      if (missing.length)
        await client.addChannelMembers(
          conversationId,
          missing.map((principalId) => ({ kind: "agent", principalId })),
        );
      if (
        channelId === "new" &&
        !(await client.listMissions()).some(
          (mission) => mission.id === input.missionId,
        )
      ) {
        await client.createMission(
          missionCreateSchema.parse({
            id: `mission-${id}`,
            conversationId,
            title: resolvedTitle,
            objective: instructions.slice(0, 4000),
            ownerAgentId: agentId,
            collaborators: input.collaborators,
            success: {
              kind: "deliverable",
              description: outcome || instructions.slice(0, 2000),
            },
            constraints:
              constraints ||
              "Work within the workspace's granted permissions. Ask before spending money or publishing externally.",
            maxExperiments: 100,
            deadline: new Date(Date.now() + 365 * 86_400_000).toISOString(),
          }),
        );
      }
      const saved = await client.schedules.save(input);
      await client.schedules.act(saved.id, "approve", {
        expectedUpdatedAt: saved.updatedAt,
      });
      onSaved();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save this schedule.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-[520px] gap-0 overflow-hidden rounded-xl p-0">
        <DialogHeader className="px-6 pt-6 pb-5 text-left">
          <DialogTitle className="text-lg font-medium tracking-tight">
            {step === 0
              ? work
                ? "Edit the plan"
                : "Give your team a job"
              : "When should it happen?"}
          </DialogTitle>
          <DialogDescription className="text-sm leading-6">
            {step === 0
              ? "Describe the work. Your team will take it from here."
              : "Set a rhythm, pick a time, or connect an event."}
          </DialogDescription>
        </DialogHeader>
        <form
          id="schedule-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (step === 0) next();
            else void save();
          }}
          className="max-h-[65vh] space-y-5 overflow-y-auto px-6 pb-6 text-sm"
        >
          {step === 0 ? (
            <>
              <label className="block space-y-2">
                <span>What should the team do?</span>
                <textarea
                  autoFocus
                  required
                  maxLength={8000}
                  className={`${scheduleSelectClass} h-auto min-h-28 resize-y py-3 leading-6`}
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  placeholder="Review last week's marketing, pick one promising idea, and build the next experiment."
                />
              </label>
              <div className="space-y-2">
                <span>Who’s taking the lead?</span>
                <Choice
                  label="Lead"
                  value={agentId}
                  onChange={(value) => {
                    setAgentId(value);
                    setCollaborators((current) =>
                      current.filter((id) => id !== value),
                    );
                  }}
                >
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      <span className="flex items-center gap-2">
                        <TeamAvatar agent={agent} />
                        {agent.name}
                      </span>
                    </SelectItem>
                  ))}
                </Choice>
              </div>
              <div className="space-y-2">
                <span>Who else should help?</span>
                <AgentMultiselect
                  agents={agents.filter((agent) => agent.id !== agentId)}
                  value={collaborators}
                  onChange={setCollaborators}
                />
              </div>
              <div className="space-y-2">
                <span>Where will they work?</span>
                <Choice
                  label="Channel"
                  value={channelId}
                  onChange={(value) => {
                    setChannelId(value);
                    setMissionId("none");
                  }}
                >
                  {channels.map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      #{channel.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="new">
                    <span className="flex items-center gap-2">
                      <Plus aria-hidden="true" className="size-3.5 shrink-0" />
                      Create a channel
                    </span>
                  </SelectItem>
                </Choice>
                {channelId === "new" && (
                  <Input
                    aria-label="New channel name"
                    required
                    maxLength={80}
                    value={channelName}
                    onChange={(event) =>
                      setChannelName(
                        event.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9-]/gu, "-"),
                      )
                    }
                    placeholder="e.g. growth-experiments"
                  />
                )}
                <p className="text-muted-foreground text-sm leading-5">
                  {channelId === "new"
                    ? "A dedicated mission channel for this team and their work."
                    : "Teammates will be added to this channel."}
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="border-border/70 border-l-2 pl-3">
                <p className="line-clamp-2 leading-6">{instructions}</p>
                <p className="text-muted-foreground mt-1">
                  {agents
                    .filter((agent) =>
                      [agentId, ...collaborators].includes(agent.id),
                    )
                    .map((agent) => agent.name)
                    .join(", ")}
                </p>
              </div>
              <Choice label="Starts" value={mode} onChange={setMode}>
                <SelectItem value="cron">On a schedule</SelectItem>
                <SelectItem value="once">Just once</SelectItem>
                <SelectItem value="webhook">When a webhook arrives</SelectItem>
              </Choice>
              {mode === "cron" ? (
                <div className="space-y-3">
                  <Choice
                    label="Repeats"
                    value={fields.frequency}
                    onChange={(value) =>
                      patchFields({
                        frequency: isScheduleFrequency(value)
                          ? value
                          : "custom",
                      })
                    }
                  >
                    {(
                      [
                        ["daily", "Every day"],
                        ["weekdays", "Weekdays"],
                        ["weekly", "Every week"],
                        ["monthly", "Every month"],
                        ["custom", "Custom cron"],
                      ] as const
                    ).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </Choice>
                  <div className="flex gap-3">
                    {fields.frequency === "weekly" && (
                      <Choice
                        label="Day of week"
                        value={fields.weekday}
                        onChange={(weekday) => patchFields({ weekday })}
                      >
                        {[
                          "Sunday",
                          "Monday",
                          "Tuesday",
                          "Wednesday",
                          "Thursday",
                          "Friday",
                          "Saturday",
                        ].map((day, index) => (
                          <SelectItem key={day} value={String(index)}>
                            {day}
                          </SelectItem>
                        ))}
                      </Choice>
                    )}
                    {fields.frequency === "monthly" && (
                      <Input
                        aria-label="Day of month"
                        required
                        type="number"
                        min={1}
                        max={31}
                        value={fields.dayOfMonth}
                        onChange={(event) =>
                          patchFields({ dayOfMonth: event.target.value })
                        }
                      />
                    )}
                    {fields.frequency !== "custom" && (
                      <Input
                        required
                        aria-label="Time"
                        type="time"
                        className="h-10"
                        value={fields.time}
                        onChange={(event) =>
                          patchFields({ time: event.target.value })
                        }
                      />
                    )}
                  </div>
                  {fields.frequency === "custom" && (
                    <Input
                      aria-label="Cron expression"
                      required
                      value={fields.custom}
                      onChange={(event) =>
                        patchFields({ custom: event.target.value })
                      }
                      placeholder="0 9 * * 1-5"
                      className="font-mono"
                    />
                  )}
                  <p className="text-muted-foreground">
                    Times in {timezone.replaceAll("_", " ")}
                  </p>
                </div>
              ) : mode === "once" ? (
                <label className="block space-y-2">
                  <span>Date and time · {localTimezone}</span>
                  <Input
                    required
                    type="datetime-local"
                    value={once}
                    onChange={(event) => setOnce(event.target.value)}
                  />
                </label>
              ) : (
                <p className="text-muted-foreground leading-6">
                  After saving, create its signed URL in Settings → Webhooks.
                </p>
              )}
              <details className="border-t pt-4">
                <summary className="text-muted-foreground cursor-pointer">
                  More options
                </summary>
                <div className="mt-4 space-y-4">
                  <label className="block space-y-2">
                    <span>Schedule name</span>
                    <Input
                      maxLength={200}
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Use the brief"
                    />
                  </label>
                  {mode === "cron" && (
                    <label className="block space-y-2">
                      <span>Timezone</span>
                      <Input
                        value={timezone}
                        onChange={(event) => setTimezone(event.target.value)}
                      />
                    </label>
                  )}
                  {channelId !== "new" &&
                    missions.some(
                      (mission) =>
                        mission.conversationId === channelId &&
                        mission.status === "active",
                    ) && (
                      <Choice
                        label="Mission"
                        value={missionId}
                        onChange={(value) => {
                          setMissionId(value);
                          const mission = missions.find(
                            (item) => item.id === value,
                          );
                          if (mission) {
                            setAgentId(mission.ownerAgentId);
                            setCollaborators(mission.collaborators);
                          }
                        }}
                      >
                        <SelectItem value="none">Independent run</SelectItem>
                        {missions
                          .filter(
                            (mission) =>
                              mission.conversationId === channelId &&
                              mission.status === "active",
                          )
                          .map((mission) => (
                            <SelectItem key={mission.id} value={mission.id}>
                              {mission.title}
                            </SelectItem>
                          ))}
                      </Choice>
                    )}
                  <label className="block space-y-2">
                    <span>Success looks like</span>
                    <Input
                      maxLength={2000}
                      value={outcome}
                      onChange={(event) => setOutcome(event.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                  <label className="block space-y-2">
                    <span>Boundaries</span>
                    <Input
                      maxLength={4000}
                      value={constraints}
                      onChange={(event) => setConstraints(event.target.value)}
                      placeholder="Anything the team should know"
                    />
                  </label>
                  <label className="block space-y-2">
                    <span>Maximum run length, in minutes</span>
                    <Input
                      type="number"
                      min={5}
                      max={1440}
                      value={budget}
                      onChange={(event) =>
                        setBudget(Number(event.target.value))
                      }
                    />
                  </label>
                </div>
              </details>
            </>
          )}
          {error && (
            <p role="alert" className="text-destructive leading-5">
              {error}
            </p>
          )}
        </form>
        <DialogFooter className="border-border/60 flex-row items-center border-t px-6 py-4 sm:justify-between">
          <span className="text-muted-foreground text-sm">{step + 1} of 2</span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => (step ? setStep(0) : onClose())}
            >
              {step ? "Back" : "Cancel"}
            </Button>
            <Button
              type="submit"
              form="schedule-form"
              disabled={busy || !agentId}
            >
              {busy
                ? "Setting up…"
                : step
                  ? work
                    ? "Save changes"
                    : "Create schedule"
                  : "Continue"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
