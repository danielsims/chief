import { useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { toast } from "sonner";

import type { RelayClient } from "@chief/relay-client";
import type { OwnedAgentRequest } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";

import { acceptAgentRequest } from "../../lib/agent-join-accept";
import { agentName } from "../../lib/owned-agent-presentation";
import { useRuntime } from "../../lib/runtime";
import { IdentityTile } from "../../pages/onboarding/elements";
import { setupPrompt } from "../../pages/onboarding/model";
import { useAgentRosterContext } from "../chat/owned-agents-value";
import { pluginActionClassName } from "../plugins/plugin-action";
import { InlineAgentName } from "./inline-agent-name";

import "../../pages/onboarding/onboarding.css";

/** Agents people connected themselves, and requests waiting for approval. */
export function useOwnedAgents() {
  const {
    client,
    agents,
    requests: open,
    loading,
    refresh,
  } = useAgentRosterContext();
  // Answered requests leave at once, so one never shows beside its agent.
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const requests = open.filter((request) => !answered.has(request.id));
  const answer = (id: string, answering: boolean) =>
    setAnswered((value) => {
      const next = new Set(value);
      if (answering) next.add(id);
      else next.delete(id);
      return next;
    });
  const [busy, setBusy] = useState(false);
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
  return { client, agents, requests, busy, run, refresh, answer, loading };
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
  return (
    <div className="ob-person">
      <IdentityTile provider={request.provider} name={request.name} />
      <span className="ob-row-text">
        <strong>
          <InlineAgentName
            value={name}
            fallback={agentName(request.provider, request.name)}
            onChange={setName}
            maxLength={48}
            title="Rename before approving"
          />{" "}
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
  state: { client, requests, busy, run, answer },
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
                answer(request.id, true);
                try {
                  if (approve) await accept(client, request, name);
                  else await client.decideOwnedAgent(request.id, false);
                } catch (error) {
                  answer(request.id, false);
                  throw error;
                }
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
