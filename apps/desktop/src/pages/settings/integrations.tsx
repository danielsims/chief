import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronLeft, Plus } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";

import type { LocalIntegrationStatus } from "@chief/agent-runtime/types";
import { api } from "@chief/backend/convex/_generated/api";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@chief/ui/components/dialog";

import { ProviderLogo } from "../../components/provider-logo";
import { providerDetails } from "../../lib/provider-details";
import {
  useDisconnectGoogleAnalytics,
  useLocalIntegrationStatus,
} from "../../lib/runtime";

interface ConnectedIntegration {
  _id?: string;
  provider: string;
  category?: string;
  displayName: string;
  externalId?: string;
  connectedAt?: number;
  lastSyncAt?: number;
}

interface CatalogIntegration {
  provider: string;
  domain: string;
  name: string;
  description: string;
}

const INTEGRATION_CATALOG: {
  category: string;
  integrations: CatalogIntegration[];
}[] = [
  {
    category: "Analytics",
    integrations: [
      {
        provider: "google-analytics",
        domain: "analytics.googleapis.com",
        name: "Google Analytics",
        description: "GA4 acquisition, traffic, and conversion reporting.",
      },
      {
        provider: "posthog.com",
        domain: "posthog.com",
        name: "PostHog",
        description: "Product analytics, funnels, and event data.",
      },
      {
        provider: "mixpanel.com",
        domain: "mixpanel.com",
        name: "Mixpanel",
        description: "Product behavior, cohorts, and retention.",
      },
    ],
  },
  {
    category: "Advertising",
    integrations: [
      {
        provider: "google-ads",
        domain: "googleads.googleapis.com",
        name: "Google Ads",
        description: "Campaign performance and conversion data.",
      },
      {
        provider: "meta",
        domain: "facebook.com",
        name: "Meta Ads",
        description: "Campaign, ad set, and creative performance.",
      },
      {
        provider: "api.linkedin.com",
        domain: "api.linkedin.com",
        name: "LinkedIn Ads",
        description: "B2B campaign and audience reporting.",
      },
    ],
  },
  {
    category: "Website & deployment",
    integrations: [
      {
        provider: "github.com",
        domain: "github.com",
        name: "GitHub",
        description: "Repository access, pull requests, and releases.",
      },
      {
        provider: "vercel.com",
        domain: "vercel.com",
        name: "Vercel",
        description: "Projects, deployments, domains, and configuration.",
      },
    ],
  },
];

function canonicalProvider(provider: string) {
  if (provider === "analytics.googleapis.com") return "google-analytics";
  if (provider === "googleads.googleapis.com") return "google-ads";
  if (provider === "graph.facebook.com" || provider === "facebook.com") {
    return "meta";
  }
  return provider;
}

function connectedIntegrations(
  channels: ConnectedIntegration[] | undefined,
  localIntegrations: LocalIntegrationStatus[] | null,
) {
  const connected = new Map<string, ConnectedIntegration>();

  for (const channel of channels ?? []) {
    connected.set(canonicalProvider(channel.provider), {
      ...channel,
      provider: canonicalProvider(channel.provider),
    });
  }

  for (const local of localIntegrations ?? []) {
    const provider = canonicalProvider(local.provider);
    if (local.status !== "connected") {
      connected.delete(provider);
      continue;
    }
    const existing = connected.get(provider);
    connected.set(provider, {
      ...existing,
      provider,
      category: existing?.category ?? local.category,
      displayName:
        existing?.displayName ??
        local.displayName ??
        providerDetails(provider).product,
      externalId: existing?.externalId ?? local.externalId,
    });
  }

  return [...connected.values()];
}

function IntegrationCatalog({ connected }: { connected: Set<string> }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus size={14} />
          Add integration
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Integrations</DialogTitle>
          <DialogDescription>
            Services Chief can use across analytics, acquisition, and your web
            stack.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 pt-2">
          {INTEGRATION_CATALOG.map((group) => (
            <section key={group.category}>
              <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                {group.category}
              </h3>
              <div className="divide-y border">
                {group.integrations.map((integration) => {
                  const isConnected = connected.has(integration.provider);
                  return (
                    <div
                      key={integration.provider}
                      className="flex items-center gap-3 p-3"
                    >
                      <ProviderLogo
                        domain={integration.domain}
                        label={integration.name}
                        className="size-8"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {integration.name}
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {integration.description}
                        </p>
                      </div>
                      {isConnected ? (
                        <Button variant="outline" size="sm" asChild>
                          <Link
                            to={`/settings/integrations/${encodeURIComponent(integration.provider)}`}
                          >
                            Manage
                          </Link>
                        </Button>
                      ) : (
                        <span className="text-muted-foreground shrink-0 text-xs">
                          Available
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function IntegrationsSettings() {
  const channels = useQuery(api.integrations.listConnected, {}) as
    ConnectedIntegration[] | undefined;
  const { integrations: localIntegrations } = useLocalIntegrationStatus();
  const connected = connectedIntegrations(channels, localIntegrations);
  const connectedProviders = new Set(
    connected.map((channel) => canonicalProvider(channel.provider)),
  );
  const checking = channels === undefined || localIntegrations === null;

  return (
    <section>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">Integrations</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Connected services available to your agents.
          </p>
        </div>
        <IntegrationCatalog connected={connectedProviders} />
      </div>
      <div className="mt-6 divide-y border">
        {connected.map((channel) => {
          const details = providerDetails(channel.provider);
          return (
            <Link
              key={channel._id ?? channel.provider}
              to={`/settings/integrations/${encodeURIComponent(channel.provider)}`}
              className="hover:bg-accent/50 flex items-center gap-4 p-4 transition-colors"
            >
              <ProviderLogo
                domain={details.productDomain}
                label={details.product}
                className="size-8"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {details.product}
                </span>
                <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                  {channel.displayName}
                </span>
              </span>
              <span className="flex items-center gap-2 text-xs">
                <span className="size-1.5 bg-emerald-500" />
                Connected
              </span>
            </Link>
          );
        })}
        {connected.length === 0 ? (
          <p className="text-muted-foreground p-5 text-sm">
            {checking
              ? "Checking connected services…"
              : "No integrations connected yet."}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function IntegrationSettingsDetail() {
  const navigate = useNavigate();
  const { provider = "" } = useParams();
  const channels = useQuery(api.integrations.listConnected, {}) as
    ConnectedIntegration[] | undefined;
  const { integrations: localIntegrations } = useLocalIntegrationStatus();
  const disconnectIntegration = useMutation(api.integrations.disconnect);
  const disconnectGoogleAnalytics = useDisconnectGoogleAnalytics();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const normalizedProvider = canonicalProvider(provider);
  const channel = connectedIntegrations(channels, localIntegrations).find(
    (item) => item.provider === normalizedProvider,
  );
  const details = providerDetails(normalizedProvider);

  const disconnect = async () => {
    setBusy(true);
    try {
      if (normalizedProvider === "google-analytics") {
        await disconnectGoogleAnalytics();
      }
      await disconnectIntegration({ provider: normalizedProvider });
      navigate("/settings/integrations", { replace: true });
    } finally {
      setBusy(false);
    }
  };

  if (channels === undefined || localIntegrations === null) {
    return (
      <p className="text-muted-foreground text-sm">Loading integration…</p>
    );
  }

  if (!channel) {
    return (
      <section>
        <Link
          to="/settings/integrations"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
        >
          <ChevronLeft size={13} />
          Integrations
        </Link>
        <p className="text-muted-foreground mt-6 text-sm">
          This integration is not connected.
        </p>
      </section>
    );
  }

  return (
    <section>
      <Link
        to="/settings/integrations"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
      >
        <ChevronLeft size={13} />
        Integrations
      </Link>
      <div className="mt-5 flex items-center gap-4">
        <ProviderLogo
          domain={details.productDomain}
          label={details.product}
          className="size-10"
        />
        <div>
          <h2 className="text-base font-medium">{details.product}</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Connected to {channel.displayName}
          </p>
        </div>
      </div>

      <dl className="mt-7 divide-y border text-sm">
        <div className="grid grid-cols-[140px_1fr] gap-5 p-4">
          <dt className="text-muted-foreground">Status</dt>
          <dd>Connected</dd>
        </div>
        <div className="grid grid-cols-[140px_1fr] gap-5 p-4">
          <dt className="text-muted-foreground">Account</dt>
          <dd>{channel.displayName}</dd>
        </div>
        {channel.externalId ? (
          <div className="grid grid-cols-[140px_1fr] gap-5 p-4">
            <dt className="text-muted-foreground">Identifier</dt>
            <dd className="font-mono text-xs">{channel.externalId}</dd>
          </div>
        ) : null}
        {channel.lastSyncAt ? (
          <div className="grid grid-cols-[140px_1fr] gap-5 p-4">
            <dt className="text-muted-foreground">Last synced</dt>
            <dd>{new Date(channel.lastSyncAt).toLocaleString()}</dd>
          </div>
        ) : null}
      </dl>

      <div className="border-destructive/40 bg-destructive/5 mt-8 border p-5">
        <h3 className="text-sm font-medium">Disconnect integration</h3>
        <p className="text-muted-foreground mt-1 max-w-lg text-xs leading-5">
          Chief will stop reading this source. Existing reports remain in your
          workspace.
        </p>
        <div className="mt-4 flex items-center gap-2">
          {confirming ? (
            <>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                {busy ? "Disconnecting…" : `Disconnect ${details.product}`}
              </Button>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="destructive" onClick={() => setConfirming(true)}>
              Disconnect
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
