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
      <HostedAgentCredential />
    </div>
  );
}

function HostedAgentCredential() {
  const { client, snapshot } = useRelaySession();
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<
    "opencode" | "vercel-ai-gateway"
  >("opencode");
  const [configuredSecrets, setConfiguredSecrets] = useState<Set<string>>(
    new Set(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!client) return;
    void Promise.all([
      client.listWorkspaceSecrets(),
      client.loadAgentConfig("chief"),
    ])
      .then(([secrets, chief]) => {
        if (!cancelled) {
          setConfiguredSecrets(new Set(secrets.map((secret) => secret.name)));
          setProvider(chief.config.inference.provider);
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
      const inference =
        provider === "vercel-ai-gateway"
          ? ({
              provider,
              model: "deepseek/deepseek-v4-flash",
              secretRef: "vercel-ai-gateway",
            } as const)
          : ({
              provider,
              model: "opencode-go/deepseek-v4-flash",
              secretRef: "opencode",
            } as const);
      await client.setWorkspaceSecret(inference.secretRef, value);
      await Promise.all(
        (snapshot?.agents ?? []).map(async (agent) => {
          const current = await client.loadAgentConfig(agent.id);
          await client.saveAgentConfig(agent.id, {
            ...current.config,
            inference,
          });
        }),
      );
      setApiKey("");
      setConfiguredSecrets((current) =>
        new Set(current).add(inference.secretRef),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const secretName =
    provider === "vercel-ai-gateway" ? "vercel-ai-gateway" : "opencode";
  const configured = configuredSecrets.has(secretName);
  const providerName =
    provider === "vercel-ai-gateway" ? "Vercel AI Gateway" : "OpenCode";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hosted agents</CardTitle>
        <CardDescription>
          Choose the inference provider for this workspace’s agents.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["vercel-ai-gateway", "Vercel AI Gateway"],
              ["opencode", "OpenCode"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setProvider(value)}
              className={`min-h-11 rounded-lg border px-3 text-sm transition-colors ${provider === value ? "border-foreground bg-muted" : "border-border hover:border-foreground/50"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              configured
                ? `Replace ${providerName} API key`
                : `${providerName} API key`
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
            ? `${providerName} is configured. Its credential cannot be read back.`
            : `Add your ${providerName} API key to use this provider.`}
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
