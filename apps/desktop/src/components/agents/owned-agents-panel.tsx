import { useCallback, useEffect, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { toast } from "sonner";

import type { RelayClient } from "@chief/relay-client";
import type { OwnedAgent, OwnedAgentRequest } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";

import { agentName } from "../../lib/owned-agent-presentation";
import { IdentityTile } from "../../pages/onboarding/elements";
import { setupPrompt } from "../../pages/onboarding/model";
import { ListRow } from "../list-row";

import "../../pages/onboarding/onboarding.css";

/** Agents people connected themselves, and requests waiting for approval. */
export function useOwnedAgents(client: RelayClient | null) {
  // Kept with the client it came from, so another workspace's agents never
  // linger while this one loads.
  const [loaded, setLoaded] = useState<{
    client: RelayClient;
    agents: OwnedAgent[];
    requests: OwnedAgentRequest[];
  } | null>(null);
  const current = loaded?.client === client ? loaded : null;
  const agents = current?.agents ?? [];
  const requests = current?.requests ?? [];
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (!client) return;
    const [connected, pending] = await Promise.all([
      client.ownedAgents(),
      client.ownedAgentRequests(),
    ]);
    setLoaded({
      client,
      agents: connected.agents,
      requests: pending.requests,
    });
  }, [client]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      // A failed poll just tries again; the list keeps what it last showed.
      await refresh().catch(() => undefined);
      if (!stopped) timer = setTimeout(() => void poll(), 8000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [refresh]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { client, agents, requests, busy, run };
}
export type OwnedAgentsState = ReturnType<typeof useOwnedAgents>;

/** Copies a prompt that lets one of your own agents ask to join. */
export function CopyInvitePromptButton({
  client,
}: {
  client: RelayClient | null;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const copy = async () => {
    if (!client || busy) return;
    setBusy(true);
    try {
      const profile = await client.accountProfile();
      if (!profile.username)
        throw new Error("Choose a username before inviting your agents.");
      const invitation = await client.createOwnedAgentInvite();
      await navigator.clipboard.writeText(
        setupPrompt(invitation.connectionUrl, profile.username),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy || !client}
      onClick={() => void copy()}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Prompt copied" : "Copy invite prompt"}
    </Button>
  );
}

/** Rows that sit in the agents list alongside Chief's team. */
export function OwnedAgentRows({
  state: { client, agents, requests, busy, run },
  channels,
}: {
  state: OwnedAgentsState;
  channels: { id: string; name: string }[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <>
      {requests.map((a) => (
        <li
          key={a.id}
          className="-mx-3 flex w-[calc(100%+24px)] items-center gap-4 rounded-lg px-3 py-2.5"
        >
          <IdentityTile provider={a.provider} name={a.name} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium tracking-[-0.01em]">
              {agentName(a.provider, a.name)} wants to join
            </span>
            <span className="text-muted-foreground block truncate text-[12px]">
              {a.handle} · Code {a.userCode}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await client?.decideOwnedAgent(a.id, true);
                })
              }
            >
              Approve
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Decline ${a.name}`}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await client?.decideOwnedAgent(a.id, false);
                })
              }
            >
              <X size={14} />
            </Button>
          </span>
        </li>
      ))}
      {agents.flatMap((a) => [
        <ListRow
          key={a.id}
          onClick={() => setExpanded(expanded === a.id ? null : a.id)}
          leading={<IdentityTile provider={a.provider} name={a.name} />}
          title={agentName(a.provider, a.name)}
          subtitle={a.handle ?? a.owner.name}
          trailing={
            <span className="text-muted-foreground flex w-28 shrink-0 items-center gap-1.5 text-[12px]">
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-emerald-500"
              />
              Connected
            </span>
          }
        />,
        expanded === a.id ? (
          <li
            key={`${a.id}:access`}
            className="bg-muted/30 my-2 space-y-3 rounded-xl border p-4"
          >
            <p className="text-muted-foreground text-[13px]">
              Channels {agentName(a.provider, a.name)} can read and post in.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {channels.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={a.channels.some((channel) => channel.id === c.id)}
                    disabled={busy}
                    onChange={(e) =>
                      void run(async () => {
                        await client?.setOwnedAgentChannel(
                          a.id,
                          c.id,
                          e.target.checked,
                        );
                      })
                    }
                  />
                  <span>#{c.name}</span>
                </label>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await client?.revokeOwnedAgent(a.id);
                })
              }
            >
              Disconnect agent
            </Button>
          </li>
        ) : null,
      ])}
    </>
  );
}
