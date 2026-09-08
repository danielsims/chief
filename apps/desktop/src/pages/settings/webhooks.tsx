import { useCallback, useEffect, useState } from "react";
import { Copy, MoreHorizontal, Plus } from "lucide-react";
import { Link } from "react-router";

import type {
  ScheduleWebhook,
  WorkspaceSchedule,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@chief/ui/components/dropdown-menu";
import { Input } from "@chief/ui/components/input";

import { useRelaySession } from "../../lib/relay-session";
import { scheduleSelectClass } from "../schedule-composer";

export function WebhooksSettings() {
  const { client } = useRelaySession();
  const [hooks, setHooks] = useState<ScheduleWebhook[]>([]);
  const [schedules, setSchedules] = useState<WorkspaceSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [revealed, setRevealed] = useState<{
    webhook: ScheduleWebhook;
    secret?: string;
  } | null>(null);
  const [copied, setCopied] = useState("");
  const refresh = useCallback(async () => {
    if (!client) return;
    const [nextHooks, nextSchedules] = await Promise.all([
      client.schedules.webhooks(),
      client.schedules.list(),
    ]);
    setHooks(nextHooks);
    setSchedules(nextSchedules);
    setError("");
  }, [client]);
  useEffect(() => {
    let active = true;
    if (!client) return;
    void Promise.all([client.schedules.webhooks(), client.schedules.list()])
      .then(([nextHooks, nextSchedules]) => {
        if (active) {
          setHooks(nextHooks);
          setSchedules(nextSchedules);
          setError("");
        }
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Could not load webhooks.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client]);
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setError("Clipboard unavailable. Select and copy the text below.");
    }
  };
  const action = async (
    hook: ScheduleWebhook,
    kind: "enable" | "disable" | "rotate" | "delete",
  ) => {
    if (!client || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await client.schedules.webhookAction(hook.id, kind);
      if (result.secret) {
        setRevealed(result);
        setCopied("");
      }
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not update this webhook.",
      );
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    if (!client || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await client.schedules.createWebhook({ name, scheduleId });
      setCreating(false);
      setRevealed(result);
      setCopied("");
      setName("");
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create this webhook.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="max-w-3xl">
      <header className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium tracking-tight">Webhooks</h1>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            Start a team run when something happens in another tool.
          </p>
        </div>
        <Button
          size="sm"
          disabled={loading || !schedules.length}
          onClick={() => {
            setCreating(true);
            setScheduleId(schedules[0]?.id ?? "");
            setError("");
          }}
        >
          <Plus size={14} />
          New webhook
        </Button>
      </header>
      {error ? (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : !hooks.length ? (
        <div className="border-border/60 rounded-lg border px-5 py-6">
          <p className="text-sm">No webhooks yet.</p>
          <p className="text-muted-foreground mt-1 text-xs leading-5">
            {schedules.length ? (
              "Connect a schedule to receive signed events."
            ) : (
              <>
                First,{" "}
                <Link to="/schedule" className="underline underline-offset-4">
                  create a schedule
                </Link>{" "}
                with a team and a brief.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="divide-border/60 border-border/60 divide-y border-y">
          {hooks.map((hook) => (
            <div key={hook.id} className="flex items-center gap-4 py-4">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => {
                    setRevealed({ webhook: hook });
                    setCopied("");
                  }}
                  className="text-left text-sm font-medium hover:underline"
                >
                  {hook.name}
                </button>
                <p className="text-muted-foreground mt-1 truncate text-xs">
                  {schedules.find((schedule) => schedule.id === hook.scheduleId)
                    ?.title ?? "Schedule removed"}{" "}
                  · {hook.enabled ? "Enabled" : "Disabled"}
                  {hook.lastDeliveryAt
                    ? ` · Last received ${new Date(hook.lastDeliveryAt).toLocaleString()}`
                    : ""}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Actions for ${hook.name}`}
                  >
                    <MoreHorizontal size={16} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setRevealed({ webhook: hook });
                      setCopied("");
                    }}
                  >
                    View connection
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      void action(hook, hook.enabled ? "disable" : "enable")
                    }
                  >
                    {hook.enabled ? "Disable" : "Enable"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void action(hook, "rotate")}
                  >
                    Replace signing secret
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() => void action(hook, "delete")}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}
      <p className="text-muted-foreground mt-5 text-xs leading-5">
        Every accepted event creates a run in its schedule. Repeated deliveries
        are deduplicated. Pausing a schedule also pauses its webhook intake.
      </p>
      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!busy) setCreating(open);
        }}
      >
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-base">New webhook</DialogTitle>
            <DialogDescription>
              Choose the team schedule this event should start.
            </DialogDescription>
          </DialogHeader>
          <form
            id="webhook-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label className="block space-y-1.5 text-xs">
              <span>Name</span>
              <Input
                required
                maxLength={100}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="New customer feedback"
              />
            </label>
            <label className="block space-y-1.5 text-xs">
              <span>Schedule</span>
              <select
                required
                className={scheduleSelectClass}
                value={scheduleId}
                onChange={(event) => setScheduleId(event.target.value)}
              >
                {schedules.map((schedule) => (
                  <option key={schedule.id} value={schedule.id}>
                    {schedule.title}
                    {schedule.status === "active"
                      ? ""
                      : ` (${schedule.status})`}
                  </option>
                ))}
              </select>
            </label>
            {error ? (
              <p role="alert" className="text-destructive text-xs">
                {error}
              </p>
            ) : null}
          </form>
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
            <Button size="sm" type="submit" form="webhook-form" disabled={busy}>
              {busy ? "Creating…" : "Create webhook"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(revealed)}
        onOpenChange={(open) => {
          if (!open) setRevealed(null);
        }}
      >
        <DialogContent className="max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-base">
              {revealed?.webhook.name}
            </DialogTitle>
            <DialogDescription>
              {revealed?.secret
                ? "Save the signing secret now. It is only shown once."
                : "Sign requests with the secret from setup. Replace it if you have lost it."}
            </DialogDescription>
          </DialogHeader>
          {revealed ? (
            <div className="space-y-4 text-xs">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span>URL</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Copy webhook URL"
                    onClick={() => void copy(revealed.webhook.url, "URL")}
                  >
                    <Copy size={13} />
                  </Button>
                </div>
                <code className="border-border/60 block rounded-md border p-3 leading-5 break-all select-text">
                  {revealed.webhook.url}
                </code>
              </div>
              {revealed.secret ? (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span>Signing secret</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Copy signing secret"
                      onClick={() => void copy(revealed.secret ?? "", "Secret")}
                    >
                      <Copy size={13} />
                    </Button>
                  </div>
                  <code className="border-border/60 block rounded-md border p-3 leading-5 break-all select-text">
                    {revealed.secret}
                  </code>
                </div>
              ) : null}
              <div className="text-muted-foreground space-y-2 leading-5">
                <p>
                  POST a JSON object, up to 64 KiB. Use a unique{" "}
                  <code>webhook-id</code> for each event and a Unix timestamp in{" "}
                  <code>webhook-timestamp</code>.
                </p>
                <p>
                  Set <code>webhook-signature</code> to <code>v1,</code>{" "}
                  followed by the base64 HMAC-SHA256 of{" "}
                  <code>id.timestamp.rawBody</code>. Decode the secret after
                  removing <code>whsec_</code> to obtain the signing key.
                </p>
                <p>
                  Sign within five minutes of delivery. For retries, keep the
                  event ID and body, and sign with a fresh timestamp. A 202
                  response includes the run ID; 409 means the schedule is
                  paused, the webhook changed, or the ID conflicts.
                </p>
              </div>
              {copied ? <p role="status">{copied} copied.</p> : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
