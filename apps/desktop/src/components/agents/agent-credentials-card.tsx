import { useEffect, useState } from "react";

import type { DriverType } from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";

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
              ? `A ${label} key is saved for this workspace. Paste a new one to replace it for every agent.`
              : `Add a ${label} key to connect this agent.`}
          </p>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            aria-label={`${label} API key`}
            placeholder={hasKey ? "Saved — paste to replace" : "Paste a key"}
            value={value}
            disabled={saving || savedNames === null}
            onChange={(event) => setValue(event.target.value)}
            className="bg-background/70 h-9 w-56 rounded-xl text-xs"
          />
          <Button size="sm" type="submit" disabled={saving || !value.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      </div>
      {error ? <AgentExecutionError message={error} /> : null}
    </div>
  );
}
