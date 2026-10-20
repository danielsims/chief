import { useCallback, useEffect, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Link } from "react-router";

import type {
  AutomationWebhook,
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

import { useRelaySession } from "../../lib/relay-session";

interface Pending {
  webhook: AutomationWebhook;
  action: "reset" | "revoke";
}

/** Every automation's webhook URL in one place, to copy, reset or revoke. */
export function WebhooksSettings() {
  const { client } = useRelaySession();
  const [hooks, setHooks] = useState<AutomationWebhook[]>([]);
  const [schedules, setSchedules] = useState<WorkspaceSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const load = useCallback(
    () =>
      client
        ? Promise.all([client.schedules.webhooks(), client.schedules.list()])
        : Promise.resolve(null),
    [client],
  );
  const refresh = async () => {
    const next = await load();
    if (!next) return;
    setHooks(next[0]);
    setSchedules(next[1]);
  };

  useEffect(() => {
    let active = true;
    load()
      .then((next) => {
        if (!active || !next) return;
        setHooks(next[0]);
        setSchedules(next[1]);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Couldn't load webhooks.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]);

  const titleOf = (webhook: AutomationWebhook) =>
    schedules.find((schedule) => schedule.id === webhook.scheduleId)?.title;

  const copy = async (webhook: AutomationWebhook) => {
    try {
      await navigator.clipboard.writeText(webhook.url);
      setNotice(`Copied the URL for ${titleOf(webhook) ?? "this draft"}.`);
    } catch {
      setError("Clipboard unavailable.");
    }
  };

  const confirm = async () => {
    if (!client || !pending || busy) return;
    setBusy(true);
    setError("");
    try {
      if (pending.action === "reset")
        await client.schedules.webhook(pending.webhook.scheduleId, {
          action: "reset",
        });
      else await client.schedules.revokeWebhook(pending.webhook.scheduleId);
      setNotice(
        pending.action === "reset"
          ? "URL reset. Paste the new one into the sending app."
          : "URL revoked.",
      );
      setPending(null);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't update this URL.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="max-w-3xl">
      <header className="mb-7">
        <h1 className="text-xl font-medium tracking-tight">Webhooks</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          The URLs other apps use to start your automations.
        </p>
      </header>
      {error ? (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {error}
        </p>
      ) : notice ? (
        <p role="status" className="text-muted-foreground mb-4 text-sm">
          {notice}
        </p>
      ) : null}
      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : !hooks.length ? (
        <div className="border-border/60 rounded-lg border px-5 py-6">
          <p className="text-sm">No webhooks yet.</p>
          <p className="text-muted-foreground mt-1 text-xs leading-5">
            Set an{" "}
            <Link to="/schedule" className="underline underline-offset-4">
              automation
            </Link>
            's trigger to Webhook to get its URL.
          </p>
        </div>
      ) : (
        <div className="divide-border/60 border-border/60 divide-y border-y">
          {hooks.map((webhook) => {
            const title = titleOf(webhook);
            return (
              <div
                key={webhook.scheduleId}
                className="flex items-center gap-4 py-4"
              >
                <div className="min-w-0 flex-1">
                  {title ? (
                    <Link
                      to={`/schedule/automations/${encodeURIComponent(webhook.scheduleId)}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {title}
                    </Link>
                  ) : (
                    <p className="text-sm font-medium">Unsaved draft</p>
                  )}
                  <p className="text-muted-foreground mt-1 truncate font-mono text-xs">
                    {webhook.url}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {webhook.signed ? "Signed" : "URL only"} ·{" "}
                    {webhook.lastDeliveryAt
                      ? `Last received ${new Date(webhook.lastDeliveryAt).toLocaleString()}`
                      : "Nothing received yet"}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={`Actions for ${title ?? "this draft"}`}
                    >
                      <MoreHorizontal size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void copy(webhook)}>
                      Copy URL
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setPending({ webhook, action: "reset" })}
                    >
                      Reset URL
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={() => setPending({ webhook, action: "revoke" })}
                    >
                      Revoke
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      )}
      <Dialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open && !busy) setPending(null);
        }}
      >
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-base">
              {pending?.action === "reset"
                ? "Reset this URL?"
                : "Revoke this URL?"}
            </DialogTitle>
            <DialogDescription>
              {pending?.action === "reset"
                ? "The current URL stops working at once. You'll need to paste the new one into the sending app."
                : "The URL stops working at once. Opening the automation's trigger gives it a new one."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {pending?.action === "reset" ? "Reset URL" : "Revoke"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
