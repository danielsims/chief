import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { CalendarDays, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router";

import type { WorkspaceSchedule } from "@chief/relay-contracts";
import { walkAutomation } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import type { AutomationCatalogue } from "./use-automation-catalogue";
import { AgentAvatar } from "../components/agent-avatar";
import { PageHeader } from "../components/page-header";
import { ProviderLogo } from "../components/provider-logo";
import { useRelaySession } from "../lib/relay-session-context";
import { StatusPill } from "./automation-builder";
import { agentName } from "./schedule-calendar-core";
import { friendlySchedule } from "./schedule-editor";
import { useAutomationCatalogue } from "./use-automation-catalogue";

const ring =
  "ring-background bg-background relative size-5 shrink-0 rounded-full ring-2";

/** Who and what an automation involves, as one overlapping stack. */
function Involved({
  schedule,
  catalogue,
}: {
  schedule: WorkspaceSchedule;
  catalogue: AutomationCatalogue;
}) {
  const steps = [...walkAutomation(schedule.automation?.steps ?? [])].map(
    ({ step }) => step,
  );
  const marks = new Map<string, ReactNode>();
  for (const agentId of [
    schedule.agentId,
    ...schedule.collaborators,
    ...steps.flatMap((step) => (step.type === "agent" ? [step.agentId] : [])),
  ])
    marks.set(
      `agent:${agentId}`,
      <AgentAvatar
        agentId={agentId}
        label={agentName(agentId)}
        className={cn(ring, "rounded-full")}
      />,
    );
  for (const step of steps) {
    if (step.type !== "tool" || step.tool.source !== "plugin") continue;
    const { connectionId } = step.tool;
    const plugin = catalogue.plugins.find((item) => item.id === connectionId);
    if (plugin?.domain)
      marks.set(
        `plugin:${plugin.id}`,
        <ProviderLogo
          domain={plugin.domain}
          label={plugin.name}
          className={ring}
        />,
      );
  }
  const shown = [...marks].slice(0, 6);
  return (
    <span className="flex items-center -space-x-1">
      {shown.map(([key, mark]) => (
        <span key={key} className="flex">
          {mark}
        </span>
      ))}
      {marks.size > shown.length ? (
        <span
          className={cn(
            ring,
            "bg-foreground/[0.06] text-muted-foreground flex items-center justify-center text-[9px] font-medium",
          )}
        >
          +{marks.size - shown.length}
        </span>
      ) : null}
    </span>
  );
}

export function AutomationsPage() {
  const navigate = useNavigate();
  const { client } = useRelaySession();
  const catalogue = useAutomationCatalogue();
  const [schedules, setSchedules] = useState<WorkspaceSchedule[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!client) return;
    let active = true;
    const refresh = () =>
      void client.schedules
        .list()
        .then((next) => {
          if (active)
            setSchedules(
              [...next].sort((left, right) => right.updatedAt - left.updatedAt),
            );
        })
        .catch(() => {
          if (active)
            setError("Couldn't load automations. Check your connection.");
        });
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [client]);

  return (
    <div className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
      <PageHeader
        title="Automations"
        description="Work your agents do on a schedule or when something happens."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigate("/schedule")}
            >
              <CalendarDays size={13} />
              Calendar
            </Button>
            <Button
              size="sm"
              onClick={() => void navigate("/schedule/automations/new")}
            >
              <Plus size={14} />
              New automation
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        {schedules?.length === 0 ? (
          <div className="flex h-[60%] flex-col items-center justify-center text-center">
            <p className="text-[15px] font-medium tracking-[-0.01em]">
              No automations yet
            </p>
            <p className="text-muted-foreground mt-1 max-w-sm text-[13px] leading-5">
              Describe something you want done regularly and Chief lays out the
              steps.
            </p>
            <Button
              size="sm"
              className="mt-5"
              onClick={() => void navigate("/schedule/automations/new")}
            >
              <Plus size={14} />
              New automation
            </Button>
          </div>
        ) : (
          <ul className="mx-auto max-w-2xl pt-2">
            {(schedules ?? []).map((schedule) => (
              <li key={schedule.id}>
                <Link
                  to={`/schedule/automations/${encodeURIComponent(schedule.id)}`}
                  className="hover:bg-accent/50 -mx-3 flex items-center gap-4 rounded-lg px-3 py-2.5 transition-colors"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium tracking-[-0.01em]">
                      {schedule.title}
                    </span>
                    <span className="text-muted-foreground block truncate text-[12px]">
                      {friendlySchedule(schedule)}
                    </span>
                  </span>
                  <Involved schedule={schedule} catalogue={catalogue} />
                  <span className="w-28 shrink-0">
                    <StatusPill status={schedule.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
