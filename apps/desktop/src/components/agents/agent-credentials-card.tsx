import { useEffect, useState } from "react";
import { Check } from "lucide-react";

import type { DriverType } from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";

import { PROVIDER_META } from "../../lib/providers";
import { AgentExecutionError } from "./agent-execution-options";

/** Workspace secrets that hold each Chief Cloud provider's key. */
const PROVIDER_SECRETS: Partial<Record<DriverType, string>> = {
  remote: "vercel-ai-gateway",
  opencode: "opencode",
};

/**
 * Owner-only: the key Chief Cloud uses for this agent's provider. Keys are
 * stored once per workspace, so replacing one applies to every agent using it.
 */
export function AgentCredentialsCard({
  provider,
  relayClient,
}: {
  provider: DriverType;
  relayClient: RelayClient;
}) {
  const secretName = PROVIDER_SECRETS[provider];
  const [savedNames, setSavedNames] = useState<Set<string> | null>(null);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void relayClient
      .listWorkspaceSecrets()
      .then((secrets) => {
        if (!cancelled) setSavedNames(new Set(secrets.map((s) => s.name)));
      })
      .catch(() => {
        if (!cancelled) setError("Couldn’t load credentials. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [relayClient]);

  if (!secretName) return null;
  const hasKey = savedNames?.has(secretName) ?? false;
  const label = PROVIDER_META[provider].label;

  const save = async () => {
    const key = value.trim();
    if (!key || saving) return;
    setSaving(true);
    setError(null);
    try {
      await relayClient.setWorkspaceSecret(secretName, key);
      setSavedNames((names) => new Set(names).add(secretName));
      setValue("");
      setOpen(false);
    } catch {
      setError("Couldn’t save the key. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-muted/25 mt-4 rounded-2xl px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium">Credentials</p>
          <p className="text-muted-foreground mt-0.5 text-[12px] leading-5 font-normal">
            {hasKey
              ? `A ${label} key is saved for this workspace and shared by every agent that uses ${label}.`
              : `Add a ${label} key to connect this agent.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {hasKey ? (
            <span className="text-muted-foreground flex items-center gap-1.5 text-[12px]">
              <Check size={13} className="text-emerald-500" />
              Saved
            </span>
          ) : null}
          <Popover
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (!next) setValue("");
            }}
          >
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant={hasKey ? "outline" : "default"}
                disabled={savedNames === null}
              >
                {hasKey ? "Manage" : "Add key"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3">
              <form
                className="flex flex-col gap-2.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <div>
                  <p className="text-[13px] font-medium">{label} API key</p>
                  <p className="text-muted-foreground mt-0.5 text-[12px] leading-5">
                    {hasKey
                      ? "A new key replaces the saved one for every agent."
                      : "It's saved for the whole workspace and isn't shown again."}
                  </p>
                </div>
                <Input
                  autoFocus
                  type="password"
                  autoComplete="off"
                  aria-label={`${label} API key`}
                  placeholder={hasKey ? "Paste a new key" : "Paste a key"}
                  value={value}
                  disabled={saving}
                  onChange={(event) => setValue(event.target.value)}
                  className="h-9 rounded-lg text-xs"
                />
                {error ? <AgentExecutionError message={error} /> : null}
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    type="submit"
                    disabled={saving || !value.trim()}
                  >
                    {saving ? "Saving…" : hasKey ? "Replace" : "Save"}
                  </Button>
                </div>
              </form>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {error && !open ? <AgentExecutionError message={error} /> : null}
    </div>
  );
}
