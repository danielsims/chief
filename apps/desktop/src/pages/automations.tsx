import { useEffect, useState } from "react";
import { ArrowUpRight, CalendarDays, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router";

import type { WorkspaceSchedule } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import { AutomationInvolved } from "../components/automation-involved";
import { insetBandClass, insetCardClass } from "../components/inset-card";
import { listColumnClass } from "../components/list-row";
import { PageHeader } from "../components/page-header";
import { workspaceCardClassName } from "../components/workspace-content-surface";
import { useRelaySession } from "../lib/relay-session-context";
import { StatusPill } from "./automation-builder";
import { AutomationsCalendarPanel } from "./automations-calendar-panel";
import { friendlySchedule } from "./schedule-editor";

export function AutomationsPage() {
  const navigate = useNavigate();
  const { client } = useRelaySession();
  const [schedules, setSchedules] = useState<WorkspaceSchedule[] | null>(null);
  const [error, setError] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(true);
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
    <div className="flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
      <main className="relative flex min-h-0 flex-1 flex-col gap-2 min-[901px]:flex-row">
        <section
          className={cn(
            workspaceCardClassName,
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          )}
        >
          <PageHeader
            title="Automations"
            description="Work your agents do on a schedule or when something happens."
            actions={
              <>
                <Button
                  variant={calendarOpen ? "secondary" : "outline"}
                  size="sm"
                  aria-pressed={calendarOpen}
                  onClick={() => setCalendarOpen((open) => !open)}
                >
                  <CalendarDays size={13} />
                  {calendarOpen ? "Hide calendar" : "Calendar"}
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
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-y-auto px-6",
              schedules?.length === 0 ? "py-8" : "pt-2 pb-8",
            )}
          >
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
            {schedules?.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <p className="text-[15px] font-medium tracking-[-0.01em]">
                  No automations yet
                </p>
                <p className="text-muted-foreground mt-1 max-w-sm text-[13px] leading-5">
                  Describe something you want done regularly and Chief lays out
                  the steps.
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
              <ul className={cn(listColumnClass, "space-y-3")}>
                {(schedules ?? []).map((schedule) => (
                  <li key={schedule.id}>
                    <Link
                      to={`/schedule/automations/${encodeURIComponent(schedule.id)}`}
                      className={cn(
                        insetBandClass,
                        "focus-visible:outline-ring block cursor-pointer text-left transition-shadow hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--foreground)_14%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2",
                      )}
                    >
                      <span className="text-muted-foreground flex h-7 items-center gap-2 px-2.5 text-xs">
                        <span className="min-w-0 flex-1 truncate">
                          {friendlySchedule(schedule)}
                        </span>
                        <StatusPill status={schedule.status} />
                        <ArrowUpRight size={13} className="shrink-0" />
                      </span>
                      <span className={cn(insetCardClass, "block")}>
                        <span className="block text-sm leading-5 font-medium">
                          {schedule.title}
                        </span>
                        <span className="mt-2.5 flex items-center">
                          <AutomationInvolved
                            schedule={schedule}
                            className="size-5"
                          />
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        {calendarOpen ? (
          <AutomationsCalendarPanel onClose={() => setCalendarOpen(false)} />
        ) : null}
      </main>
    </div>
  );
}
