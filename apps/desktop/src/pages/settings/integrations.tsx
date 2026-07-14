import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronLeft } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";

import { api } from "@chief/backend/convex/_generated/api";
import { Button } from "@chief/ui/components/button";

import { ProviderLogo } from "../../components/provider-logo";
import {
  GOOGLE_ANALYTICS_PROVIDER,
  providerDetails,
} from "../../lib/provider-details";

interface ConnectedIntegration {
  _id: string;
  provider: string;
  category?: string;
  displayName: string;
  externalId?: string;
  connectedAt?: number;
  lastSyncAt?: number;
}

export function IntegrationsSettings() {
  const channels = useQuery(api.integrations.listConnected, {}) as
    ConnectedIntegration[] | undefined;

  return (
    <section>
      <h2 className="text-sm font-medium">Integrations</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Connected services available to your agents.
      </p>
      <div className="mt-6 divide-y border">
        {channels?.map((channel) => {
          const details = providerDetails(channel.provider);
          return (
            <Link
              key={channel._id}
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
              <span className="text-muted-foreground text-xs">Manage</span>
            </Link>
          );
        })}
        {channels?.length === 0 ? (
          <p className="text-muted-foreground p-5 text-sm">
            No integrations connected.
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
  const disconnectGoogleAnalytics = useMutation(api.googleAnalytics.disconnect);
  const disconnectIntegration = useMutation(api.integrations.disconnect);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const channel = channels?.find((item) => item.provider === provider);
  const details = providerDetails(provider);

  const disconnect = async () => {
    setBusy(true);
    try {
      if (provider === GOOGLE_ANALYTICS_PROVIDER) {
        await disconnectGoogleAnalytics({});
      } else {
        await disconnectIntegration({ provider });
      }
      navigate("/settings/integrations", { replace: true });
    } finally {
      setBusy(false);
    }
  };

  if (channels === undefined) {
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
