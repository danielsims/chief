import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import type {
  DiagnosticEventRecord,
  SessionRecord,
} from "@chief/agent-runtime/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chief/ui/components/card";
import { cn } from "@chief/ui/lib/utils";

import { useAuth } from "../../lib/auth/auth-context";
import { useDiagnostics } from "../../lib/runtime";

interface TreeSession {
  session: SessionRecord;
  depth: number;
}

function formatTime(timestamp: number | undefined) {
  if (timestamp === undefined) return "Not recorded";
  return new Date(timestamp).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatShortTime(timestamp: number) {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function statusTone(status: SessionRecord["status"]) {
  if (status === "failed") return "bg-destructive";
  if (status === "running") return "animate-pulse bg-emerald-500";
  if (status === "waiting") return "bg-sky-400";
  if (status === "needs_approval") return "bg-amber-400";
  if (status === "completed") return "bg-foreground";
  return "bg-muted-foreground/50";
}

function levelTone(level: DiagnosticEventRecord["level"]) {
  if (level === "error") return "bg-destructive";
  if (level === "warn") return "bg-amber-400";
  if (level === "info") return "bg-sky-400";
  return "bg-muted-foreground/50";
}

function buildSessionTree(sessions: SessionRecord[]): TreeSession[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const children = new Map<string, SessionRecord[]>();
  const roots: SessionRecord[] = [];
  const newestFirst = (a: SessionRecord, b: SessionRecord) =>
    b.updatedAt - a.updatedAt;

  for (const session of sessions) {
    if (
      session.parentId &&
      session.parentId !== session.id &&
      byId.has(session.parentId)
    ) {
      const siblings = children.get(session.parentId) ?? [];
      siblings.push(session);
      children.set(session.parentId, siblings);
    } else {
      roots.push(session);
    }
  }

  roots.sort(newestFirst);
  for (const siblings of children.values()) siblings.sort(newestFirst);

  const result: TreeSession[] = [];
  const visited = new Set<string>();
  const append = (session: SessionRecord, depth: number) => {
    if (visited.has(session.id)) return;
    visited.add(session.id);
    result.push({ session, depth });
    for (const child of children.get(session.id) ?? []) {
      append(child, depth + 1);
    }
  };

  for (const root of roots) append(root, 0);
  for (const session of [...sessions].sort(newestFirst)) append(session, 0);
  return result;
}

function stringifyData(data: unknown) {
  try {
    if (data === undefined) return "null";
    return JSON.stringify(data, null, 2);
  } catch {
    return "[Unable to serialize redacted event data]";
  }
}

function MetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-b px-3 py-3 last:border-b-0 sm:last:border-b sm:[&:nth-last-child(-n+2)]:border-b-0">
      <dt className="text-muted-foreground text-[10px] tracking-wide uppercase">
        {label}
      </dt>
      <dd className="mt-1 truncate font-mono text-xs" title={value}>
        {value}
      </dd>
    </div>
  );
}

function SessionList({
  sessions,
  selectedId,
  onSelect,
}: {
  sessions: TreeSession[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="max-h-72 min-h-0 overflow-y-auto border-b lg:max-h-none lg:border-r lg:border-b-0">
      <div className="border-b px-4 py-3">
        <p className="text-xs font-medium">Sessions</p>
        <p className="text-muted-foreground mt-0.5 text-[10px]">
          {sessions.length} recorded
        </p>
      </div>
      <div className="py-1">
        {sessions.map(({ session, depth }) => (
          <button
            key={session.id}
            type="button"
            onClick={() => onSelect(session.id)}
            className={cn(
              "hover:bg-accent/50 flex w-full items-start gap-2.5 border-l-2 border-transparent py-2.5 pr-3 text-left transition-colors",
              selectedId === session.id && "border-foreground bg-accent",
            )}
            style={{ paddingLeft: 12 + Math.min(depth, 6) * 14 }}
          >
            <span
              className={cn(
                "mt-1.5 size-1.5 shrink-0",
                statusTone(session.status),
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">
                {session.title || session.id}
              </span>
              <span className="text-muted-foreground mt-1 block truncate text-[10px]">
                {depth === 0 ? "Root" : "Child"} / {session.kind} /{" "}
                {session.agent}
              </span>
              <span className="text-muted-foreground mt-0.5 block text-[10px]">
                {formatShortTime(session.updatedAt)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function EventList({ events }: { events: DiagnosticEventRecord[] }) {
  if (events.length === 0) {
    return (
      <div className="text-muted-foreground flex min-h-32 items-center justify-center rounded-xl border px-5 text-center text-xs">
        No diagnostic events were recorded for this session.
      </div>
    );
  }

  return (
    <div className="divide-y overflow-hidden rounded-xl border">
      {events.map((event) => (
        <details key={event.id} className="group">
          <summary className="hover:bg-accent/30 flex cursor-pointer list-none items-center gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden">
            <span className={cn("size-1.5 shrink-0", levelTone(event.level))} />
            <span className="w-8 shrink-0 font-mono text-[10px] tabular-nums">
              {event.position}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs">
              {event.type}
            </span>
            <span className="text-muted-foreground shrink-0 text-[10px] uppercase">
              {event.level}
            </span>
            <time className="text-muted-foreground hidden shrink-0 text-[10px] md:block">
              {formatShortTime(event.createdAt)}
            </time>
            <ChevronDown
              size={12}
              className="text-muted-foreground shrink-0 transition-transform group-open:rotate-180"
            />
          </summary>
          <div className="border-t bg-black/10 px-3 py-3">
            <div className="text-muted-foreground mb-2 flex items-center justify-between gap-3 text-[10px]">
              <span>Redacted JSON</span>
              <time>{formatTime(event.createdAt)}</time>
            </div>
            <pre className="max-h-96 overflow-auto font-mono text-[11px] leading-5 break-words whitespace-pre-wrap">
              {stringifyData(event.data)}
            </pre>
          </div>
        </details>
      ))}
    </div>
  );
}

function SessionDetails({
  session,
  events,
}: {
  session: SessionRecord;
  events: DiagnosticEventRecord[];
}) {
  return (
    <article className="min-w-0 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div className="min-w-0">
          <p className="text-muted-foreground font-mono text-[10px] break-all">
            {session.id}
          </p>
          <h3 className="mt-1 text-2xl font-normal">{session.title}</h3>
        </div>
        <span className="flex items-center gap-2 rounded-full border px-2 py-1 text-[10px] uppercase">
          <span className={cn("size-1.5", statusTone(session.status))} />
          {session.status.replace("_", " ")}
        </span>
      </div>

      <dl className="mt-4 grid overflow-hidden rounded-xl border sm:grid-cols-2">
        <MetadataItem label="Kind" value={session.kind} />
        <MetadataItem label="Visibility" value={session.visibility} />
        <MetadataItem label="Agent" value={session.agent} />
        <MetadataItem
          label="Provider / model"
          value={`${session.provider}${session.model ? ` / ${session.model}` : ""}`}
        />
        <MetadataItem label="Status" value={session.status} />
        <MetadataItem
          label="Schedule ID"
          value={session.scheduleId ?? "None"}
        />
        <MetadataItem
          label="Parent session"
          value={session.parentId ?? "None"}
        />
        <MetadataItem label="Trigger ID" value={session.triggerId ?? "None"} />
        <MetadataItem label="Attempt" value={String(session.attempt)} />
        <MetadataItem
          label="Scheduled for"
          value={formatTime(session.scheduledFor)}
        />
        <MetadataItem label="Created" value={formatTime(session.createdAt)} />
        <MetadataItem label="Updated" value={formatTime(session.updatedAt)} />
        <MetadataItem label="Started" value={formatTime(session.startedAt)} />
        <MetadataItem label="Finished" value={formatTime(session.finishedAt)} />
      </dl>

      {session.summary ? (
        <section className="mt-4 rounded-xl border p-4">
          <h4 className="text-muted-foreground text-[10px] tracking-wide uppercase">
            Summary
          </h4>
          <p className="mt-2 text-xs leading-5 whitespace-pre-wrap">
            {session.summary}
          </p>
        </section>
      ) : null}
      {session.error ? (
        <section className="border-destructive/40 bg-destructive/5 mt-4 rounded-xl border p-4">
          <h4 className="text-destructive text-[10px] tracking-wide uppercase">
            Error
          </h4>
          <p className="mt-2 font-mono text-xs leading-5 whitespace-pre-wrap">
            {session.error}
          </p>
        </section>
      ) : null}

      <section className="mt-6">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <h4 className="text-sm font-medium">Diagnostic events</h4>
            <p className="text-muted-foreground mt-0.5 text-[10px]">
              Ordered by runtime position
            </p>
          </div>
          <span className="text-muted-foreground text-[10px]">
            {events.length} events
          </span>
        </div>
        <EventList events={events} />
      </section>
    </article>
  );
}

export function DiagnosticsSettings() {
  const { cloudOrganizationId } = useAuth();
  const { sessions, events, loading } = useDiagnostics(cloudOrganizationId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tree = useMemo(() => buildSessionTree(sessions), [sessions]);
  const selected =
    sessions.find((session) => session.id === selectedId) ?? tree[0]?.session;
  const selectedEvents = useMemo(
    () =>
      selected
        ? events
            .filter((event) => event.sessionId === selected.id)
            .sort(
              (a, b) => a.position - b.position || a.createdAt - b.createdAt,
            )
        : [],
    [events, selected],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Diagnostics</CardTitle>
        <CardDescription>
          Read-only runtime sessions and redacted event data for this workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-muted-foreground flex min-h-64 items-center justify-center rounded-xl border text-sm">
            Loading session diagnostics...
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex min-h-64 items-center justify-center rounded-xl border px-6 text-center">
            <div>
              <p className="text-sm font-medium">No diagnostic sessions</p>
              <p className="text-muted-foreground mt-1 text-xs leading-5">
                Runtime sessions will appear here after an agent starts work.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid min-h-[560px] overflow-hidden rounded-xl border lg:grid-cols-[260px_minmax(0,1fr)]">
            <SessionList
              sessions={tree}
              selectedId={selected?.id}
              onSelect={setSelectedId}
            />
            {selected ? (
              <div className="min-h-0 overflow-y-auto">
                <SessionDetails session={selected} events={selectedEvents} />
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
