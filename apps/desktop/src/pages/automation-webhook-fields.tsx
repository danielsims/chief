import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import type { RelayClient } from "@chief/relay-client";
import type {
  AutomationWebhook,
  AutomationWebhookRequest,
} from "@chief/relay-contracts";
import { cn } from "@chief/ui/lib/utils";

import { controlClass, PanelSection } from "./automation-panel";

const quietButton =
  "bg-foreground/[0.045] hover:bg-foreground/[0.08] text-muted-foreground hover:text-foreground flex h-7 shrink-0 items-center justify-center rounded-[6px] px-2 text-[11px] disabled:opacity-50";

/** A text button that asks once more before doing something destructive. */
function ConfirmButton({
  label,
  confirmLabel,
  title,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  title: string;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 2_500);
    return () => window.clearTimeout(timer);
  }, [confirming]);
  return (
    <button
      type="button"
      title={title}
      onClick={() => {
        if (!confirming) return setConfirming(true);
        setConfirming(false);
        onConfirm();
      }}
      className={cn(
        "text-[11px]",
        confirming
          ? "text-destructive"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {confirming ? confirmLabel : label}
    </button>
  );
}

/**
 * The automation's inbound URL and optional signing secret. The URL is issued
 * for the draft's id, so it exists before the first save. The secret is
 * write-only: once saved it never comes back to this or any other client.
 */
export function WebhookFields({
  client,
  automationId,
}: {
  client: RelayClient | null | undefined;
  automationId: string;
}) {
  const [webhook, setWebhook] = useState<AutomationWebhook | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [secret, setSecret] = useState("");
  const [replacingSecret, setReplacingSecret] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!client) return;
    let active = true;
    client.schedules
      .webhook(automationId)
      .then((next) => {
        if (active) setWebhook(next);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Couldn't get a URL.",
          );
      });
    return () => {
      active = false;
    };
  }, [client, automationId]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const send = async (request: AutomationWebhookRequest) => {
    if (!client || busy) return false;
    setBusy(true);
    try {
      setWebhook(await client.schedules.webhook(automationId, request));
      setError("");
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "That didn't work. Try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveSecret = async () => {
    if (await send({ action: "set-signing-secret", secret: secret.trim() })) {
      setSecret("");
      setReplacingSecret(false);
    }
  };

  const copy = () => {
    if (webhook)
      void navigator.clipboard
        .writeText(webhook.url)
        .then(() => setCopied(true));
  };

  const editingSecret = !webhook?.signed || replacingSecret;

  return (
    <>
      <PanelSection
        title="Webhook URL"
        action={
          webhook ? (
            <ConfirmButton
              label="Reset"
              confirmLabel="Confirm reset"
              title="The old URL stops working."
              onConfirm={() => void send({ action: "reset" })}
            />
          ) : null
        }
      >
        <div className="flex gap-1">
          <input
            aria-label="Webhook URL"
            readOnly
            value={webhook?.url ?? ""}
            placeholder={error ? "" : "Getting a URL…"}
            onFocus={(event) => event.currentTarget.select()}
            className={cn(controlClass, "font-mono text-[11px]")}
          />
          <button
            type="button"
            aria-label="Copy webhook URL"
            disabled={!webhook}
            onClick={copy}
            className={cn(quietButton, "w-7 px-0")}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
      </PanelSection>
      {webhook ? (
        <PanelSection
          title="Signing secret"
          action={
            webhook.signed && !replacingSecret ? (
              <ConfirmButton
                label="Remove"
                confirmLabel="Confirm remove"
                title="Unsigned events will be accepted again."
                onConfirm={() => void send({ action: "remove-signing-secret" })}
              />
            ) : null
          }
        >
          {editingSecret ? (
            <form
              className="flex gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                void saveSecret();
              }}
            >
              <input
                aria-label="Signing secret"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={secret}
                placeholder="whsec_… (optional)"
                onChange={(event) => setSecret(event.target.value)}
                className={cn(controlClass, "font-mono text-[11px]")}
              />
              <button
                type="submit"
                disabled={busy || !secret.trim()}
                className={quietButton}
              >
                Save
              </button>
              {replacingSecret ? (
                <button
                  type="button"
                  onClick={() => {
                    setSecret("");
                    setReplacingSecret(false);
                  }}
                  className={quietButton}
                >
                  Cancel
                </button>
              ) : null}
            </form>
          ) : (
            <div className="flex gap-1">
              <span
                aria-label="Signing secret saved"
                className={cn(
                  controlClass,
                  "text-muted-foreground flex items-center tracking-[0.2em]",
                )}
              >
                ••••••••••••
              </span>
              <button
                type="button"
                onClick={() => setReplacingSecret(true)}
                className={quietButton}
              >
                Replace
              </button>
            </div>
          )}
        </PanelSection>
      ) : null}
      {error ? (
        <p className="text-destructive px-3 pb-3 text-[11px] leading-4">
          {error}
        </p>
      ) : null}
    </>
  );
}
