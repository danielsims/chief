import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Play,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import type { JsonObject, WorkspaceSchedule } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@chief/ui/components/dropdown-menu";
import { Switch } from "@chief/ui/components/switch";
import { cn } from "@chief/ui/lib/utils";

import type { CanvasSelection, PickerOptions } from "./automation-canvas";
import type { AutomationDraft, StepSlot } from "./automation-draft";
import type { PickedStep } from "./automation-step-picker";
import { usePluginConnectFlow } from "../components/plugins/plugin-connect-flow";
import { routeForChiefDestination } from "../lib/app-navigation";
import { useAuth } from "../lib/auth/auth-context";
import { useRelaySession } from "../lib/relay-session-context";
import { messageBlocks, useChiefChat } from "../lib/runtime";
import { usePlugins } from "../lib/runtime-plugins";
import { channelChatId } from "../lib/workspace-channels";
import { TriggerEventContext } from "./automation-arguments";
import { AutomationCanvas } from "./automation-canvas";
import { AutomationComposer, draftingMessage } from "./automation-describe";
import {
  draftFromWork,
  draftIssueMap,
  draftToInput,
  findStep,
  insertStep,
  moveStep,
  newStep,
  readStoredDraft,
  removeStep,
  stepAgents,
  updateStep,
  writeStoredDraft,
} from "./automation-draft";
import { SettingsPanel, StepPanel } from "./automation-inspector";
import { AutomationReviewDialog } from "./automation-review";
import { TriggerPanel } from "./automation-trigger-fields";
import { workStatusLabel } from "./schedule-calendar-core";
import { approvalTiming } from "./schedule-editor";
import { useAutomationCatalogue } from "./use-automation-catalogue";
import { useAutomationRuns } from "./use-automation-test";

export function StatusPill({
  status,
}: {
  status: WorkspaceSchedule["status"] | "new";
}) {
  const dot =
    status === "active"
      ? "bg-emerald-500"
      : status === "needs_approval"
        ? "bg-amber-500"
        : status === "error"
          ? "bg-destructive"
          : "bg-foreground/25";
  return (
    <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-[12px]">
      <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />
      {status === "new" ? "Draft" : workStatusLabel(status)}
    </span>
  );
}

function useTeamOptions() {
  const { snapshot } = useRelaySession();
  return useMemo(() => {
    const channels =
      snapshot?.conversations
        .filter((channel) => channel.kind === "channel")
        .map((channel) => ({ id: channel.id, name: channel.name })) ?? [];
    const agents = (snapshot?.agents ?? [])
      .flatMap((agent) => [agent, ...agent.subagents])
      .filter(
        (agent, index, all) =>
          agent.canMessage !== false &&
          all.findIndex((item) => item.id === agent.id) === index,
      );
    return { channels, agents };
  }, [snapshot]);
}

export function AutomationBuilderPage() {
  const { automationId = "new" } = useParams();
  const navigate = useNavigate();
  const { client } = useRelaySession();
  const { cloudOrganizationId } = useAuth();
  const catalogue = useAutomationCatalogue();
  const { channels, agents } = useTeamOptions();
  const plugins = usePlugins();
  const connect = usePluginConnectFlow(plugins);
  const defaults = {
    agentId:
      agents.find((agent) => agent.id === "chief")?.id ??
      agents[0]?.id ??
      "chief",
    channelId: channels[0]?.id ?? "new",
  };
  const [schedule, setSchedule] = useState<WorkspaceSchedule | null>(null);
  const [draft, setDraft] = useState<AutomationDraft>(
    () =>
      (automationId === "new" ? readStoredDraft("new", null) : null) ??
      draftFromWork(null, defaults),
  );
  const [savedJson, setSavedJson] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(automationId === "new");
  const [selected, setSelected] = useState<CanvasSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  /** When the latest request to Chief was sent, if one was. */
  const [askedAt, setAskedAt] = useState<number | null>(null);

  const adopt = useCallback((record: WorkspaceSchedule) => {
    const next = draftFromWork(record, {
      agentId: record.agentId,
      channelId: record.conversationId,
    });
    setSchedule(record);
    setDraft(next);
    setSavedJson(JSON.stringify(next));
  }, []);

  useEffect(() => {
    if (automationId === "new" || !client) return;
    let active = true;
    void client.schedules
      .list()
      .then((records) => {
        if (!active) return;
        const record = records.find((item) => item.id === automationId);
        if (record) {
          adopt(record);
          // Pick up where a reload interrupted, if nothing changed since.
          const unsaved = readStoredDraft(record.id, record.updatedAt);
          if (unsaved) setDraft(unsaved);
        } else toast.error("This automation no longer exists.");
      })
      .catch(() => {
        if (active)
          toast.error("Couldn't load this automation. Check your connection.");
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [adopt, automationId, client]);

  const runs = useAutomationRuns(client, schedule);

  // The latest webhook event, for Insert to offer its fields. Events arrive
  // even before the automation is saved or switched on.
  const [triggerEvent, setTriggerEvent] = useState<JsonObject | null>(null);
  useEffect(() => {
    if (!client || draft.mode !== "webhook") return;
    let active = true;
    const load = () =>
      void client.schedules
        .webhookEvents(draft.id)
        .then((events) => {
          if (active) setTriggerEvent(events[0]?.input ?? null);
        })
        .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [client, draft.id, draft.mode]);

  // The composer posts an ordinary @chief message in the automation's channel,
  // exactly as the channel composer does. Chief builds, tests and fixes it
  // there with the same tools as anywhere else, and the thread shows its work.
  const chatChannel =
    draft.channelId === "new" ? "mission-control" : draft.channelId;
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const chat = useChiefChat(
    askedAt === null ? null : channelChatId(chatChannel, cloudOrganizationId),
    undefined,
    undefined,
    undefined,
    {
      channelId: chatChannel,
      wakeOnMentionOnly: true,
      conversationSurface: "channel",
    },
  );
  const chatNote = useMemo(() => {
    if (askedAt === null) return null;
    for (const item of [...chat.messages].reverse()) {
      if (item.role !== "assistant") continue;
      if ((item.metadata?.createdAt ?? 0) < askedAt) break;
      const text = messageBlocks(item)
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join(" ")
        .trim();
      if (text) return text;
    }
    return null;
  }, [askedAt, chat.messages]);
  // Working from the moment the request is sent until Chief's turn ends with
  // a reply, or the request fails.
  const chiefWorking =
    askedAt !== null &&
    !chat.controls.error &&
    (chat.controls.status === "running" || chatNote === null);

  // Show each version Chief saves while it works, and the last one once done.
  const adoptedAt = useRef(0);
  useEffect(() => {
    if (askedAt === null || !client) return;
    const refresh = () =>
      void client.schedules.list().then((records) => {
        const record = records.find((item) => item.id === draft.id);
        if (
          record &&
          record.updatedAt >= askedAt &&
          record.updatedAt > adoptedAt.current
        ) {
          adoptedAt.current = record.updatedAt;
          adopt(record);
          setSelected(null);
        }
      });
    refresh();
    if (!chiefWorking) return;
    const timer = window.setInterval(refresh, 2_500);
    return () => window.clearInterval(timer);
  }, [adopt, askedAt, chiefWorking, client, draft.id]);

  // A plugin connected from the + menu shows up in the menu once it's ready.
  const connectedKey = (plugins.plugins ?? [])
    .filter((plugin) => plugin.status === "connected")
    .map((plugin) => plugin.id)
    .join(",");
  const { reload } = catalogue;
  useEffect(() => {
    if (connectedKey) reload();
  }, [connectedKey, reload]);

  const [leadAccess, setLeadAccess] = useState<{
    agentId: string;
    plugins: string[];
  } | null>(null);
  const leadPlugins =
    leadAccess?.agentId === draft.agentId ? leadAccess.plugins : null;
  useEffect(() => {
    if (!client) return;
    let active = true;
    void client
      .loadAgentConfig(draft.agentId)
      .then((result) => {
        if (active)
          setLeadAccess({
            agentId: result.agentId,
            plugins: result.config.integrations,
          });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [client, draft.agentId, connectedKey]);

  const connectable = useMemo(
    () =>
      (plugins.plugins ?? [])
        .filter(
          (plugin) =>
            plugin.source.type === "discovery" && plugin.status !== "connected",
        )
        .sort(
          (left, right) =>
            Number(Boolean(right.featured)) - Number(Boolean(left.featured)) ||
            left.name.localeCompare(right.name),
        ),
    [plugins.plugins],
  );
  const picker: PickerOptions = {
    catalogue,
    agents,
    connectable,
    onConnect: connect.open,
    onAddServer: connect.addServer,
  };

  const issues = useMemo(() => draftIssueMap(draft), [draft]);
  const dirty = savedJson === null || savedJson !== JSON.stringify(draft);
  useEffect(() => {
    if (!loaded) return;
    writeStoredDraft(
      automationId,
      schedule?.updatedAt ?? null,
      dirty && (schedule || draft.steps.length || draft.title) ? draft : null,
    );
  }, [automationId, dirty, draft, loaded, schedule]);
  const status = schedule?.status ?? "new";
  const patch = (next: Partial<AutomationDraft>) =>
    setDraft((current) => ({ ...current, ...next }));
  const selectedStep =
    selected && selected !== "trigger" && selected !== "settings"
      ? findStep(draft.steps, selected)
      : undefined;

  // The team is exactly the agents taking steps, so it never goes stale.
  const setSteps = (steps: AutomationDraft["steps"]) =>
    setDraft((current) => ({
      ...current,
      steps,
      collaborators: stepAgents(steps).filter((id) => id !== current.agentId),
    }));

  const insert = (slot: StepSlot, picked: PickedStep) => {
    const agentId = picked.agentId ?? draft.agentId;
    const step = newStep(draft.steps, picked.kind, {
      agentId,
      agentName: agents.find((agent) => agent.id === agentId)?.name,
      tool: picked.tool,
    });
    setSteps(insertStep(draft.steps, slot, step));
    setSelected(step.id);
  };

  const save = async () => {
    if (!client || busy) return;
    if (issues.size) {
      toast.error(
        issues.values().next().value ?? "Finish the highlighted steps first.",
      );
      return;
    }
    setBusy(true);
    try {
      const saved = await client.schedules.save(draftToInput(draft));
      writeStoredDraft(automationId, null, null);
      adopt(saved);
      if (automationId === "new")
        void navigate(`/schedule/automations/${encodeURIComponent(saved.id)}`, {
          replace: true,
        });
      if (saved.status === "needs_approval" || saved.status === "draft")
        setReviewing(true);
      else toast.success("Saved");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't save this automation.",
      );
    } finally {
      setBusy(false);
    }
  };

  const act = async (
    action: "approve" | "pause" | "resume" | "run" | "test",
  ) => {
    if (!client || !schedule || busy) return;
    setBusy(true);
    try {
      const next = await client.schedules.act(schedule.id, action, {
        expectedUpdatedAt: schedule.updatedAt,
      });
      if (action === "run")
        toast.success("Running now. Follow along here or in its channel.");
      if (action === "test") runs.refresh();
      adopt(next);
      setReviewing(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "That didn't work. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!client || !schedule) return;
    await client.schedules.delete(schedule.id);
    void navigate("/schedule/automations");
  };

  const describe = (description: string) => {
    setAskedAt(Date.now());
    setThreadRootId(
      chat.sendMessageWithContext(
        draftingMessage(description, draft, Boolean(schedule) && !dirty),
        { mentions: ["chief"] },
      ),
    );
  };

  if (!loaded)
    return (
      <div className="-mx-8 -mb-8 h-[calc(100vh-48px)] bg-[color-mix(in_srgb,var(--foreground)_2.5%,var(--background))]" />
    );

  return (
    <TriggerEventContext value={triggerEvent}>
      <div className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-black/[0.055] px-5 dark:border-white/[0.06]">
          <nav className="flex min-w-0 flex-1 items-center gap-1.5 text-[14px]">
            <Link
              to="/schedule/automations"
              className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
            >
              Automations
            </Link>
            <ChevronRight
              size={13}
              className="text-muted-foreground/60 shrink-0"
            />
            <input
              aria-label="Automation name"
              value={draft.title}
              placeholder="Untitled automation"
              onChange={(event) => patch({ title: event.target.value })}
              className="placeholder:text-muted-foreground/70 hover:bg-accent/50 focus:bg-accent/50 min-w-0 rounded-md px-1.5 py-1 font-medium tracking-[-0.01em] outline-none"
              style={{ width: `${Math.max(12, draft.title.length + 2)}ch` }}
            />
            {status === "error" ? <StatusPill status={status} /> : null}
            {dirty && schedule ? (
              <span className="text-muted-foreground text-[11px]">Unsaved</span>
            ) : null}
          </nav>
          <div className="flex shrink-0 items-center gap-1.5">
            {schedule?.status === "active" || schedule?.status === "paused" ? (
              <label className="text-muted-foreground mr-1.5 flex items-center gap-2 text-[12px]">
                {schedule.status === "active" ? "On" : "Off"}
                <Switch
                  aria-label="Automation on"
                  checked={schedule.status === "active"}
                  disabled={busy || dirty}
                  onCheckedChange={(on) => void act(on ? "resume" : "pause")}
                />
              </label>
            ) : null}
            {schedule && draft.steps.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy || dirty || runs.testing}
                title="Runs it once now. Reads and agents run for real; writes are only previewed."
                onClick={() => void act("test")}
              >
                {runs.testing ? (
                  <Loader2 size={12} className="animate-spin text-sky-500" />
                ) : runs.testPassed ? (
                  <Check
                    size={12}
                    strokeWidth={3}
                    className="text-emerald-500"
                  />
                ) : null}
                {runs.testing ? "Testing…" : "Test"}
              </Button>
            ) : null}
            {schedule?.status === "active" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy || dirty}
                onClick={() => void act("run")}
              >
                <Play size={12} />
                Run now
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={selected === "settings"}
              className={cn(selected === "settings" && "bg-accent")}
              onClick={() =>
                setSelected((current) =>
                  current === "settings" ? null : "settings",
                )
              }
            >
              Settings
            </Button>
            {schedule ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="More actions"
                  >
                    <MoreHorizontal size={15} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-40 rounded-lg p-1"
                >
                  {schedule.lastMessageId ? (
                    <DropdownMenuItem
                      className="rounded-md text-xs"
                      onSelect={() =>
                        void navigate(
                          `/conversations?${new URLSearchParams({ channel: schedule.conversationId, thread: schedule.lastMessageId ?? "" }).toString()}`,
                        )
                      }
                    >
                      Open latest run
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    className="text-destructive rounded-md text-xs"
                    onSelect={() => void remove()}
                  >
                    Delete automation
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {!dirty && (status === "needs_approval" || status === "draft") ? (
              <Button
                size="sm"
                disabled={busy || (draft.steps.length > 0 && !runs.testPassed)}
                title={
                  draft.steps.length > 0 && !runs.testPassed
                    ? "Test it first. Writes are only previewed during a test."
                    : undefined
                }
                onClick={() => setReviewing(true)}
              >
                Review and turn on
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy || !dirty}
                onClick={() => void save()}
              >
                {busy ? "Saving…" : schedule ? "Save" : "Create"}
              </Button>
            )}
          </div>
        </header>
        <div className="relative flex min-h-0 flex-1">
          <AutomationCanvas
            draft={draft}
            picker={picker}
            agents={agents}
            selected={selected}
            issues={issues}
            runNodes={runs.nodes}
            triggered={runs.triggered}
            onSelect={setSelected}
            onInsert={insert}
            onMove={(id, overId) => setSteps(moveStep(draft.steps, id, overId))}
            composer={
              <AutomationComposer
                busy={chiefWorking}
                note={chiefWorking ? null : chatNote}
                onOpenThread={
                  threadRootId
                    ? () =>
                        void navigate(
                          routeForChiefDestination({
                            kind: "conversation",
                            channelId: chatChannel,
                            threadRootId,
                            messageId: threadRootId,
                          }),
                        )
                    : undefined
                }
                disabled={catalogue.loading || !client}
                onSubmit={describe}
              />
            }
          />
          {/* Floats over the canvas only while something is open in it. */}
          <div className="pointer-events-none absolute top-3 right-3 bottom-3 flex flex-col">
            <div className="pointer-events-auto flex min-h-0 flex-col">
              {selectedStep ? (
                <StepPanel
                  key={selectedStep.id}
                  step={selectedStep}
                  draft={draft}
                  agents={agents}
                  catalogue={catalogue}
                  issue={issues.get(selectedStep.id)}
                  leadPlugins={leadPlugins}
                  node={runs.nodes[selectedStep.id]}
                  onChange={(next) =>
                    setSteps(
                      updateStep(draft.steps, selectedStep.id, () => next),
                    )
                  }
                  onRemove={() => {
                    setSteps(removeStep(draft.steps, selectedStep.id));
                    setSelected(null);
                  }}
                  onClose={() => setSelected(null)}
                />
              ) : selected === "trigger" ? (
                <TriggerPanel
                  client={client}
                  draft={draft}
                  onChange={patch}
                  onClose={() => setSelected(null)}
                />
              ) : selected === "settings" ? (
                <SettingsPanel
                  draft={draft}
                  agents={agents}
                  channels={channels}
                  onChange={patch}
                  onClose={() => setSelected(null)}
                />
              ) : null}
            </div>
          </div>
        </div>
        <AutomationReviewDialog
          open={reviewing && schedule !== null}
          title={draft.title || "this automation"}
          timing={schedule ? approvalTiming(schedule) : ""}
          steps={draft.steps}
          team={[draft.agentId, ...draft.collaborators]}
          catalogue={catalogue}
          busy={busy}
          onApprove={() => void act("approve")}
          onClose={() => setReviewing(false)}
        />
        {connect.dialogs}
      </div>
    </TriggerEventContext>
  );
}
