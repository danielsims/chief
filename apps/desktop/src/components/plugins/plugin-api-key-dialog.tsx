import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { PluginAuthorizationAction } from "@chief/agent-runtime/types";
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

import type { PluginApiKeyInput } from "../../lib/runtime-plugins";
import { ProviderLogo } from "../provider-logo";

export type PluginApiKeyAction = Extract<
  PluginAuthorizationAction,
  { kind: "plugin_api_key" }
>;

/**
 * Asks for the key a plugin signs in with. Chief checks it against the server
 * before keeping it, so a rejected key leaves the dialog open to try again.
 */
export function PluginApiKeyDialog({
  action,
  replacing = false,
  onClose,
  onSubmit,
}: {
  action: PluginApiKeyAction;
  /** Swapping the key of a plugin that's already added. */
  replacing?: boolean;
  onClose: () => void;
  onSubmit: (input: PluginApiKeyInput) => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const docsUrl = action.docsUrl;
  const close = () => {
    if (!busy) onClose();
  };
  const submit = async () => {
    const value = apiKey.trim();
    if (!value || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit({ apiKey: value });
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : `${action.pluginName} rejected this key.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="border-border/80 w-[calc(100%-32px)] max-w-[420px] gap-0 overflow-hidden rounded-2xl p-0">
        <DialogHeader className="flex-row items-center gap-3 space-y-0 px-6 pt-6 pb-4 text-left">
          <ProviderLogo
            domain={
              action.provider.includes(".") ? action.provider : action.pluginId
            }
            label={action.pluginName}
            className="size-9 shrink-0 overflow-hidden rounded-xl"
          />
          <div className="min-w-0 space-y-0.5">
            <DialogTitle className="text-[17px] leading-6 font-semibold tracking-[-0.02em]">
              {replacing
                ? `Replace ${action.pluginName} key`
                : `Connect ${action.pluginName}`}
            </DialogTitle>
            <DialogDescription className="text-xs leading-5">
              Get your {action.label} from{" "}
              {docsUrl ? (
                <button
                  type="button"
                  className="text-foreground underline underline-offset-2"
                  onClick={() => void openUrl(docsUrl)}
                >
                  {action.pluginName}
                </button>
              ) : (
                action.pluginName
              )}
              .
            </DialogDescription>
          </div>
        </DialogHeader>
        <form
          className="space-y-2 px-6 pb-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            disabled={busy}
            type="password"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setError("");
            }}
            placeholder={action.label.replace(/^./u, (c) => c.toUpperCase())}
            aria-label={action.label}
            aria-invalid={Boolean(error)}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            className="h-10 font-sans text-sm"
          />
          {error ? (
            <p className="text-destructive text-xs leading-5">{error}</p>
          ) : null}
        </form>
        <DialogFooter className="border-border/60 items-center border-t px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-md text-xs"
            onClick={close}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="rounded-md text-xs"
            disabled={!apiKey.trim() || busy}
            onClick={() => void submit()}
          >
            {busy ? "Connecting…" : replacing ? "Replace key" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
