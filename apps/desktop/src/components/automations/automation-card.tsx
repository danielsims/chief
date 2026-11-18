import { useMemo, useState } from "react";
import { ArrowUpRight, Check, FlaskConical, Pause, Play } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import type { GenerativeAutomationData } from "@chief/agent-runtime/types";
import type {
  WorkspaceSchedule,
  WorkspaceScheduleAction,
} from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import { MatrixLoader } from "@chief/ui/components/matrix-loader";
import { Skeleton } from "@chief/ui/components/skeleton";
import { cn } from "@chief/ui/lib/utils";

import type { AutomationDraft } from "../../pages/automation-draft";
import { canManageChannels } from "../../lib/auth/organization-role";
import { useRelaySession } from "../../lib/relay-session-context";
import {
  adoptAutomationRecord,
  useAutomationRecord,
} from "../../lib/use-automation-record";
import { useWorkspaceRole } from "../../lib/workspace-role";
import { StatusPill, useTeamOptions } from "../../pages/automation-builder";
import {
  draftFromWork,
  draftIssueMap,
  draftToInput,
} from "../../pages/automation-draft";
import { friendlySchedule } from "../../pages/schedule-editor";
import { useAutomationRuns } from "../../pages/use-automation-test";
import { AutomationInvolved } from "../automation-involved";
import { insetBandClass, insetCardClass } from "../inset-card";
import { AutomationCardFlow } from "./automation-card-flow";

/**
 * An automation in a conversation, drawn like the automations list: a soft
 * band around a white card. The band names it and says where it stands; the
 * card holds its title, who is involved and its flow; the footer band is
 * where the person acts on it.
 *
 * The card is reconciled with the automation itself, as an AI SDK data part
 * is by id: it always shows the automation as it is now. Edits made here are
 * a local draft until saved, and saving or approving updates every card and
 * page showing the same automation.
 */
export function AutomationCard({ data }: { data: GenerativeAutomationData }) {
  const { record, state } = useAutomationRecord(data.automationId);
  if (state === "loading")
    return (
      <Frame label="Automation">
        <span className={cn(insetCardClass, "block space-y-2")}>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </span>
      </Frame>
    );
  if (!record)
    return (
      <Frame label="Automation">
        <span className={cn(insetCardClass, "block")}>
          <span className="block truncate text-sm leading-5 font-medium">
            {data.title}
          </span>
          <span className="text-muted-foreground mt-1 block text-xs">
            This automation was deleted or isn't shared with you.
          </span>
        </span>
      </Frame>
    );
  return <LiveAutomationCard record={record} />;
}

function LiveAutomationCard({ record }: { record: WorkspaceSchedule }) {
  const navigate = useNavigate();
  const { client } = useRelaySession();
  const { agents } = useTeamOptions();
  // The relay lets only workspace admins change or run automations.
  const role = useWorkspaceRole();
  const canChange = Boolean(client) && canManageChannels(role);
  const [edits, setEdits] = useState<AutomationDraft | null>(null);
  const [busy, setBusy] = useState<WorkspaceScheduleAction | "save" | null>(
    null,
  );
  const saved = useMemo(
    () =>
      draftFromWork(record, {
        agentId: record.agentId,
        channelId: record.conversationId,
      }),
    [record],
  );
  const draft = edits ?? saved;
  const dirty = edits !== null;
  const issues = useMemo(() => draftIssueMap(draft), [draft]);
  const hasSteps = Boolean(record.automation?.steps.length);
  const awaitingApproval =
    record.status === "needs_approval" || record.status === "draft";
  // Runs are only followed while they decide what the person can do next.
  const runs = useAutomationRuns(
    client,
    hasSteps && awaitingApproval ? record : null,
  );
  const open = () =>
    void navigate(`/schedule/automations/${encodeURIComponent(record.id)}`);

  const change = (patch: Partial<AutomationDraft>) =>
    setEdits((current) => ({ ...(current ?? saved), ...patch }));

  const save = async () => {
    if (!client || busy) return;
    if (issues.size) {
      toast.error(issues.values().next().value ?? "Finish the steps first.");
      return;
    }
    setBusy("save");
    try {
      const input = draftToInput(draft);
      const next = await client.schedules.save({
        ...input,
        // What the agent proposed stays proposed; this card edits the work.
        approvalSummary: record.approvalSummary || input.approvalSummary,
        proposedToolPatterns: record.proposedToolPatterns,
      });
      adoptAutomationRecord(next);
      setEdits(null);
      toast.success("Saved");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't save this automation.",
      );
    } finally {
      setBusy(null);
    }
  };

  const act = async (action: WorkspaceScheduleAction) => {
    if (!client || busy) return;
    setBusy(action);
    try {
      const next = await client.schedules.act(record.id, action, {
        expectedUpdatedAt: record.updatedAt,
      });
      adoptAutomationRecord(next);
      if (action === "test") runs.refresh();
      if (action === "approve") toast.success("Approved. It's live.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "That didn't work. Try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  const needsTest = hasSteps && awaitingApproval && !runs.testPassed;
  const hint = dirty
    ? "Unsaved changes"
    : runs.testing
      ? "Testing…"
      : awaitingApproval
        ? needsTest
          ? runs.testState === "failed" || runs.testState === "blocked"
            ? "The last test didn't pass. Open a step to see why."
            : "Test it first. Writes are only previewed."
          : "Ready for your approval"
        : record.status === "active"
          ? record.nextAt
            ? `Next run ${new Date(record.nextAt).toLocaleString([], {
                weekday: "short",
                hour: "numeric",
                minute: "2-digit",
              })}`
            : "Live"
          : record.status === "paused"
            ? "Paused"
            : record.status === "error"
              ? "Something's wrong. Open it to see what."
              : "";

  return (
    <Frame
      label={friendlySchedule(record)}
      status={<StatusPill status={record.status} />}
      onOpen={open}
      footer={
        <>
          <span className="text-muted-foreground flex min-w-0 flex-1 items-center gap-1.5 truncate">
            {runs.testing ? (
              <MatrixLoader size={12} ariaLabel="Testing" />
            ) : null}
            <span className="truncate">{hint}</span>
          </span>
          {dirty ? (
            <>
              <Button
                variant="ghost"
                size="xs"
                disabled={busy !== null}
                onClick={() => setEdits(null)}
              >
                Discard
              </Button>
              <Button
                size="xs"
                disabled={busy !== null}
                onClick={() => void save()}
              >
                {busy === "save" ? "Saving…" : "Save"}
              </Button>
            </>
          ) : canChange ? (
            <Actions
              record={record}
              needsTest={needsTest}
              testing={runs.testing}
              busy={busy}
              onAct={(action) => void act(action)}
            />
          ) : null}
        </>
      }
    >
      <span className={cn(insetCardClass, "block")}>
        <span className="block text-sm leading-5 font-medium">
          {draft.title || record.title}
        </span>
        <span className="mt-2 flex items-center gap-2">
          <AutomationInvolved schedule={record} className="size-5" />
        </span>
        <AutomationCardFlow
          draft={draft}
          agents={agents}
          issues={issues}
          nodes={runs.nodes}
          editable={canChange}
          onChange={change}
        />
      </span>
    </Frame>
  );
}

function Actions({
  record,
  needsTest,
  testing,
  busy,
  onAct,
}: {
  record: WorkspaceSchedule;
  needsTest: boolean;
  testing: boolean;
  busy: string | null;
  onAct: (action: WorkspaceScheduleAction) => void;
}) {
  const disabled = busy !== null;
  if (record.status === "needs_approval" || record.status === "draft")
    return needsTest ? (
      <Button
        size="xs"
        variant="outline"
        disabled={disabled || testing}
        onClick={() => onAct("test")}
      >
        <FlaskConical size={12} />
        {testing ? "Testing…" : "Test"}
      </Button>
    ) : (
      <Button size="xs" disabled={disabled} onClick={() => onAct("approve")}>
        <Check size={12} />
        {busy === "approve" ? "Approving…" : "Approve"}
      </Button>
    );
  if (record.status === "active")
    return (
      <>
        <Button
          size="xs"
          variant="ghost"
          disabled={disabled}
          onClick={() => onAct("pause")}
        >
          <Pause size={12} />
          Pause
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={() => onAct("run")}
        >
          <Play size={12} />
          Run now
        </Button>
      </>
    );
  if (record.status === "paused")
    return (
      <Button
        size="xs"
        variant="outline"
        disabled={disabled}
        onClick={() => onAct("resume")}
      >
        <Play size={12} />
        Resume
      </Button>
    );
  return null;
}

/** The band and its header and footer rows, around the card. */
function Frame({
  label,
  status,
  onOpen,
  footer,
  children,
}: {
  label: string;
  status?: React.ReactNode;
  onOpen?: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label="Automation"
      className={cn(insetBandClass, "block w-full max-w-md text-left")}
    >
      <span className="text-muted-foreground flex h-7 items-center gap-2 px-2.5 text-[12px]">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {status}
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label="Open in Automations"
            className="hover:text-foreground -mr-1 flex size-5 items-center justify-center rounded transition-colors"
          >
            <ArrowUpRight size={13} />
          </button>
        ) : null}
      </span>
      {children}
      {footer ? (
        <span className="flex min-h-9 items-center gap-1.5 px-2.5 pt-1 text-[12px]">
          {footer}
        </span>
      ) : null}
    </section>
  );
}
