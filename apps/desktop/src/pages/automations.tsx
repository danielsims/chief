import { useEffect, useState } from "react";
import { CalendarDays, Plus } from "lucide-react";
import { useNavigate } from "react-router";

import type { WorkspaceSchedule } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";

import { AutomationInvolved } from "../components/automation-involved";
import { listColumnClass, ListRow } from "../components/list-row";
import { PageHeader } from "../components/page-header";
import { useRelaySession } from "../lib/relay-session-context";
import { StatusPill } from "./automation-builder";
import { friendlySchedule } from "./schedule-editor";

export function AutomationsPage() {
  const navigate = useNavigate();
  const { client } = useRelaySession();
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
          <ul className={listColumnClass}>
            {(schedules ?? []).map((schedule) => (
              <ListRow
                key={schedule.id}
                to={`/schedule/automations/${encodeURIComponent(schedule.id)}`}
                title={schedule.title}
                subtitle={friendlySchedule(schedule)}
                trailing={
                  <>
                    <AutomationInvolved
                      schedule={schedule}
                      className="size-5"
                    />
                    <span className="w-28 shrink-0">
                      <StatusPill status={schedule.status} />
                    </span>
                  </>
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
