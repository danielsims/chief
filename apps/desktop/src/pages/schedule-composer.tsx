import { useEffect, useState } from "react";

import type { RecurringWorkRecord } from "@chief/agent-runtime/types";
import type { ChannelMember, Mission } from "@chief/relay-contracts";
import { workspaceScheduleInputSchema } from "@chief/relay-contracts";
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

import { useRelaySession } from "../lib/relay-session";
import {
  cronFromFields,
  fieldsFromCron,
  isScheduleFrequency,
} from "./schedule-editor";

export const scheduleSelectClass =
  "border-input bg-background h-9 w-full rounded-md border px-3 text-[13px] outline-none focus:ring-2 focus:ring-ring/30";
const textAreaClass = `${scheduleSelectClass} h-auto min-h-20 resize-y py-2 leading-5`;

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
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [id] = useState(() => work?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(work?.title ?? "");
  const [channelId, setChannelId] = useState(
    work?.conversationId ?? channels[0]?.id ?? "",
  );
  const [agentId, setAgentId] = useState(work?.agentId ?? "");
  const [collaborators, setCollaborators] = useState<string[]>(
    work?.collaborators ?? [],
  );
  const [missionId, setMissionId] = useState(work?.missionId ?? "");
  const [members, setMembers] = useState<ChannelMember[]>([]);
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!client || !channelId) return;
    void Promise.all([
      client.listChannelMembers(channelId),
      client.listMissions(),
    ])
      .then(([nextMembers, nextMissions]) => {
        if (!active) return;
        const agents = nextMembers.filter((member) => member.kind === "agent");
        setMembers(agents);
        setMissions(
          nextMissions.filter(
            (mission) =>
              mission.conversationId === channelId &&
              mission.status === "active",
          ),
        );
        setAgentId((current) =>
          agents.some((member) => member.principalId === current)
            ? current
            : (agents[0]?.principalId ?? ""),
        );
        setCollaborators((current) =>
          current.filter((id) =>
            agents.some((member) => member.principalId === id),
          ),
        );
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Could not load the team.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, channelId]);
  const mission = missions.find((item) => item.id === missionId);
  const team = mission
    ? members.filter(
        (member) =>
          member.principalId === mission.ownerAgentId ||
          mission.collaborators.some((id) => id === member.principalId),
      )
    : members;
  const patchFields = (patch: Partial<typeof fields>) =>
    setFields((current) => ({ ...current, ...patch }));
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
      const input = workspaceScheduleInputSchema.parse({
        id,
        title,
        conversationId: channelId,
        agentId,
        collaborators: collaborators.filter((id) => id !== agentId),
        missionId: missionId || undefined,
        instructions,
        expectedOutcome: outcome,
        constraints,
        maxDurationMinutes: budget,
        triggerMode: mode === "webhook" ? "webhook" : "cron",
        onceAt,
        timezone: mode === "once" ? localTimezone : timezone,
        cron: cronFromFields(fields),
        approvalSummary: outcome,
        proposedToolPatterns: work?.proposedToolPatterns ?? [],
        skipDates: work?.skipDates ?? [],
      });
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
      <DialogContent className="max-w-[560px] gap-0 overflow-hidden rounded-xl p-0">
        <DialogHeader className="px-5 pt-5 pb-4 text-left">
          <DialogTitle className="text-[17px] font-medium tracking-tight">
            {work ? "Edit schedule" : "New schedule"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Give the team a brief and a result to work towards.
          </DialogDescription>
        </DialogHeader>
        <form
          id="schedule-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="max-h-[65vh] space-y-4 overflow-y-auto px-5 pb-5 text-xs"
        >
          <label className="block space-y-1.5">
            <span>Name</span>
            <Input
              required
              maxLength={200}
              autoFocus
              placeholder="Weekly growth experiment"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span>Channel</span>
              <select
                aria-label="Channel"
                className={scheduleSelectClass}
                value={channelId}
                onChange={(event) => {
                  setLoading(true);
                  setChannelId(event.target.value);
                  setMissionId("");
                  setError("");
                }}
              >
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span>Mission</span>
              <select
                aria-label="Mission"
                className={scheduleSelectClass}
                value={missionId}
                onChange={(event) => {
                  const selected = missions.find(
                    (mission) => mission.id === event.target.value,
                  );
                  setMissionId(event.target.value);
                  if (selected) {
                    setAgentId(selected.ownerAgentId);
                    setCollaborators(selected.collaborators);
                    if (!outcome)
                      setOutcome(
                        selected.success.kind === "deliverable"
                          ? selected.success.description
                          : `${selected.success.name}: ${selected.success.target} ${selected.success.unit}`,
                      );
                  }
                }}
              >
                <option value="">Independent run</option>
                {missions.map((mission) => (
                  <option key={mission.id} value={mission.id}>
                    {mission.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block space-y-1.5">
            <span>Lead</span>
            <select
              required
              aria-label="Lead"
              className={scheduleSelectClass}
              value={agentId}
              disabled={loading}
              onChange={(event) => setAgentId(event.target.value)}
            >
              <option value="" disabled>
                {loading ? "Loading team…" : "Choose a lead"}
              </option>
              {team.map((member) => (
                <option key={member.principalId} value={member.principalId}>
                  {member.name ?? member.principalId}
                </option>
              ))}
            </select>
          </label>
          {!loading && !members.length ? (
            <p className="text-muted-foreground">
              Add an agent to this channel before scheduling work.
            </p>
          ) : null}
          {team.length > 1 ? (
            <fieldset>
              <legend className="mb-2">Collaborators</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {team
                  .filter((member) => member.principalId !== agentId)
                  .map((member) => (
                    <label
                      key={member.principalId}
                      className="flex items-center gap-2"
                    >
                      <input
                        type="checkbox"
                        className="accent-foreground"
                        checked={collaborators.includes(member.principalId)}
                        onChange={(event) =>
                          setCollaborators((current) =>
                            event.target.checked
                              ? [...current, member.principalId]
                              : current.filter(
                                  (id) => id !== member.principalId,
                                ),
                          )
                        }
                      />
                      {member.name ?? member.principalId}
                    </label>
                  ))}
              </div>
            </fieldset>
          ) : null}
          <label className="block space-y-1.5">
            <span>Brief</span>
            <textarea
              required
              maxLength={8000}
              className={textAreaClass}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Review last week's campaign, choose one promising change and build the next experiment."
            />
          </label>
          <label className="block space-y-1.5">
            <span>Expected result</span>
            <Input
              maxLength={2000}
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
              placeholder="A campaign draft, with a hypothesis and a measurable target"
            />
          </label>
          <label className="block space-y-1.5">
            <span>Constraints</span>
            <Input
              maxLength={4000}
              value={constraints}
              onChange={(event) => setConstraints(event.target.value)}
              placeholder="Draft only. Ask before spending or publishing."
            />
          </label>
          <div className="border-border/60 space-y-3 border-t pt-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span>Starts</span>
                <select
                  aria-label="Starts"
                  className={scheduleSelectClass}
                  value={mode}
                  onChange={(event) => setMode(event.target.value)}
                >
                  <option value="cron">On a schedule</option>
                  <option value="once">Once</option>
                  <option value="webhook">From a webhook</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span>Time limit (minutes)</span>
                <Input
                  required
                  type="number"
                  min={5}
                  max={1440}
                  value={budget}
                  onChange={(event) => setBudget(Number(event.target.value))}
                />
              </label>
            </div>
            {mode === "cron" ? (
              <>
                <div className="flex gap-2">
                  <select
                    aria-label="Repeats"
                    className={scheduleSelectClass}
                    value={fields.frequency}
                    onChange={(event) =>
                      patchFields({
                        frequency: isScheduleFrequency(event.target.value)
                          ? event.target.value
                          : "custom",
                      })
                    }
                  >
                    {[
                      ["daily", "Every day"],
                      ["weekdays", "Weekdays"],
                      ["weekly", "Weekly"],
                      ["monthly", "Monthly"],
                      ["custom", "Custom cron"],
                    ].map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {fields.frequency === "weekly" ? (
                    <select
                      aria-label="Day of week"
                      className={scheduleSelectClass}
                      value={fields.weekday}
                      onChange={(event) =>
                        patchFields({ weekday: event.target.value })
                      }
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
                        <option key={day} value={index}>
                          {day}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {fields.frequency === "monthly" ? (
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
                  ) : null}
                  {fields.frequency !== "custom" ? (
                    <Input
                      required
                      aria-label="Time"
                      type="time"
                      value={fields.time}
                      onChange={(event) =>
                        patchFields({ time: event.target.value })
                      }
                    />
                  ) : null}
                </div>
                {fields.frequency === "custom" ? (
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
                ) : null}
                <label className="block space-y-1.5">
                  <span>Timezone</span>
                  <Input
                    required
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                  />
                </label>
              </>
            ) : mode === "once" ? (
              <label className="block space-y-1.5">
                <span>Date and time · {localTimezone}</span>
                <Input
                  required
                  type="datetime-local"
                  value={once}
                  onChange={(event) => setOnce(event.target.value)}
                />
              </label>
            ) : (
              <p className="text-muted-foreground leading-5">
                Create a signed URL in Settings → Webhooks after saving.
              </p>
            )}
          </div>
          {error ? (
            <p role="alert" className="text-destructive leading-5">
              {error}
            </p>
          ) : null}
        </form>
        <DialogFooter className="border-border/60 border-t px-5 py-3">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            type="submit"
            form="schedule-form"
            disabled={busy || loading || !client || !agentId}
          >
            {busy ? "Saving…" : "Save and activate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
