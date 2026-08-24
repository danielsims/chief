import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Copy, ExternalLink, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import type { PluginAuthorizationAction } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { Input } from "@chief/ui/components/input";

import type { PluginOAuthClientInput } from "../../lib/runtime-plugins";

type OAuthClientAction = Extract<
  PluginAuthorizationAction,
  { kind: "plugin_oauth_client" }
>;

export function PluginOAuthClientDialog({
  action,
  busy,
  onClose,
  onSubmit,
}: {
  action: OAuthClientAction;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: PluginOAuthClientInput) => Promise<void>;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const setupUrl = action.setupUrl;

  const copyCallback = async () => {
    try {
      await navigator.clipboard.writeText(action.callbackUrl);
      toast.success("Callback URL copied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle>Connect {action.pluginName}</DialogTitle>
          <DialogDescription className="leading-5">
            This provider requires a registered OAuth app. Create one in the
            provider&apos;s developer console, add the callback URL below, then
            enter its credentials. Chief stores them in the private workspace
            vault.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const normalizedId = clientId.trim();
            if (!normalizedId) return;
            void onSubmit({
              serverName: action.serverName,
              clientId: normalizedId,
              ...(clientSecret ? { clientSecret } : undefined),
            });
          }}
        >
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Callback URL</span>
            <span className="flex gap-2">
              <Input
                value={action.callbackUrl}
                readOnly
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Copy callback URL"
                onClick={() => void copyCallback()}
              >
                <Copy size={14} />
              </Button>
            </span>
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Client ID</span>
            <Input
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              autoComplete="off"
              required
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Client secret</span>
            <Input
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              autoComplete="new-password"
              placeholder="Optional for public clients"
            />
          </label>
          <div className="flex items-center justify-between gap-3 pt-1">
            {setupUrl ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void openUrl(setupUrl)}
              >
                <ExternalLink size={14} /> Open provider setup
              </Button>
            ) : (
              <span />
            )}
            <span className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !clientId.trim()}>
                {busy ? (
                  <LoaderCircle className="animate-spin" size={14} />
                ) : null}
                Continue
              </Button>
            </span>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
