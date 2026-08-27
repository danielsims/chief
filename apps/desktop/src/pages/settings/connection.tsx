import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Check, Copy, ShieldCheck } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chief/ui/components/card";
import { Input } from "@chief/ui/components/input";

import { CHIEF_CLOUD_RELAY_URL, RELAY_URL } from "../../lib/config";
import { useRelaySession } from "../../lib/relay-session";

export function ConnectionSettings() {
  const [copied, setCopied] = useState(false);
  const relayUrl = new URL(RELAY_URL).origin;
  const chiefHosted = relayUrl === new URL(CHIEF_CLOUD_RELAY_URL).origin;

  const copyRelayUrl = async () => {
    await navigator.clipboard.writeText(relayUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
          <CardDescription>
            The relay and signed device identity used by this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          <ConnectionRow label="Relay address">
            <div className="flex min-w-0 items-center gap-2">
              <span className="max-w-96 truncate">{relayUrl}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label="Copy relay address"
                onClick={() => void copyRelayUrl()}
              >
                {copied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
            </div>
          </ConnectionRow>
          <ConnectionRow label="Hosting">
            <span>{chiefHosted ? "Chief Cloud" : "Self-hosted"}</span>
          </ConnectionRow>
          <ConnectionRow label="Identity">
            <span className="flex items-center gap-2">
              <ShieldCheck
                className="text-muted-foreground size-4"
                aria-hidden
              />
              Signed device
            </span>
          </ConnectionRow>
        </CardContent>
      </Card>
      {!chiefHosted ? <HostedAgentCredential /> : null}
    </div>
  );
}

function HostedAgentCredential() {
  const { client } = useRelaySession();
  const [apiKey, setApiKey] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!client) return;
    void client
      .listWorkspaceSecrets()
      .then((secrets) => {
        if (!cancelled) {
          setConfigured(secrets.some((secret) => secret.name === "opencode"));
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const save = async () => {
    const value = apiKey.trim();
    if (!client || !value || saving) return;
    setSaving(true);
    setError(null);
    try {
      await client.setWorkspaceSecret("opencode", value);
      setApiKey("");
      setConfigured(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hosted agents</CardTitle>
        <CardDescription>
          OpenCode inference is encrypted by this relay and scoped to this
          workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              configured ? "Enter a replacement API key" : "OpenCode API key"
            }
            autoComplete="new-password"
            disabled={!client || saving}
          />
          <Button
            type="button"
            onClick={() => void save()}
            disabled={!client || !apiKey.trim() || saving}
            loading={saving}
          >
            {configured ? "Replace" : "Save"}
          </Button>
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          {configured
            ? "An inference credential is configured. Its value cannot be read back."
            : "Required for agents hosted on this self-hosted relay."}
        </p>
        {error ? (
          <p className="text-destructive mt-2 text-xs">{error}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ConnectionRow({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-6 px-5 py-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  );
}
