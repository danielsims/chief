import { useCallback, useEffect, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { toast } from "sonner";

import type { RelayClient } from "@chief/relay-client";
import type { OwnedAgent, OwnedAgentRequest } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";

import { acceptAgentRequest } from "../../lib/agent-join-accept";
import { agentName } from "../../lib/owned-agent-presentation";
import { useRuntime } from "../../lib/runtime";
import { IdentityTile } from "../../pages/onboarding/elements";
import { setupPrompt } from "../../pages/onboarding/model";
import { pluginActionClassName } from "../plugins/plugin-action";

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
  return {
    client,
    agents,
    requests,
    busy,
    run,
    refresh,
    loading: Boolean(client) && current === null,
  };
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

/** One agent asking to join, exactly as onboarding's approval step shows it. */
export function AgentJoinRequestRow({
  request,
  busy,
  onDecide,
  inlineCode = false,
}: {
  request: OwnedAgentRequest;
  busy: boolean;
  /** Puts the verification code beside the handle, for narrow layouts. */
  inlineCode?: boolean;
  /** Approval carries the name chosen on the card. */
  onDecide: (approve: boolean, name: string) => void;
}) {
  const [name, setName] = useState(() =>
    agentName(request.provider, request.name),
  );
  const [editing, setEditing] = useState(false);
  return (
    <div className="ob-person">
      <IdentityTile provider={request.provider} name={request.name} />
      <span className="ob-row-text">
        <strong>
          {editing ? (
            <input
              autoFocus
              aria-label="Agent name"
              value={name}
              maxLength={48}
              size={Math.max(name.length, 3)}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "Escape")
                  setEditing(false);
              }}
              className="bg-foreground/[0.06] rounded-[5px] font-medium outline-none"
            />
          ) : (
            <button
              type="button"
              title="Rename before approving"
              onClick={() => setEditing(true)}
              className="hover:bg-foreground/[0.06] -mx-0.5 cursor-text rounded-[5px] px-0.5 font-medium"
            >
              {name.trim() || agentName(request.provider, request.name)}
            </button>
          )}{" "}
          requested to join
        </strong>
        <code title="Check the code matches the one your agent shows">
          {request.handle}
          {inlineCode ? ` · ${request.userCode}` : null}
        </code>
      </span>
      {inlineCode ? null : (
        <span
          className="bg-background text-foreground mr-1 shrink-0 rounded-lg px-2.5 py-1.5 font-mono text-[13px] font-medium tracking-[0.08em] shadow-[0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)]"
          title="Check this matches the code your agent shows"
          aria-label={`Verification code ${request.userCode}`}
        >
          {request.userCode}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        className={pluginActionClassName}
        onClick={() => onDecide(true, name)}
        disabled={busy}
      >
        Approve
      </Button>
      <button
        className="ob-icon-button"
        aria-label={`Decline ${request.name}`}
        onClick={() => onDecide(false, name)}
        disabled={busy}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** Requests waiting on you, under the agents already in the workspace. */
export function AgentJoinRequests({
  state: { client, requests, busy, run },
}: {
  state: OwnedAgentsState;
}) {
  const accept = useAcceptAgentRequest();
  if (requests.length === 0) return null;
  return (
    <section className="mt-8" aria-label="Agents requesting to join">
      <h2 className="mb-3 text-sm font-medium">Requests to join</h2>
      <div className="bg-muted/40 text-foreground rounded-2xl px-4">
        {requests.map((request) => (
          <AgentJoinRequestRow
            key={request.id}
            request={request}
            busy={busy}
            onDecide={(approve, name) =>
              void run(async () => {
                if (!client) return;
                if (approve) await accept(client, request, name);
                else await client.decideOwnedAgent(request.id, false);
              })
            }
          />
        ))}
      </div>
    </section>
  );
}

/** Approves a request, as an on-device agent when this computer can run it. */
export function useAcceptAgentRequest() {
  const { agents, createNativeAgent } = useRuntime();
  return (client: RelayClient, request: OwnedAgentRequest, name: string) =>
    acceptAgentRequest({ client, request, name, agents, createNativeAgent });
}
