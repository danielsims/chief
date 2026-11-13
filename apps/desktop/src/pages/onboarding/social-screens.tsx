import { useEffect, useState } from "react";
import { Check, Copy, LoaderCircle, Plus, Search, X } from "lucide-react";
import { z } from "zod";

import type { WorkspaceSetup } from "./use-setup";
import { ChiefMark } from "../../components/chief-mark";
import { IntegrationChoiceCard } from "../../components/integrations/integration-choice-card";
import { OrgLogo } from "../../components/org-logo";
import { agentName } from "../../lib/owned-agent-presentation";
import { workspaceOnboardingApps } from "../workspace-create-options";
import { IdentityTile, ProviderIcon, SetupHeading } from "./elements";
import { setupPrompt } from "./model";

export function AppsScreen({ setup: s }: { setup: WorkspaceSetup }) {
  const [query, setQuery] = useState("");
  const apps = workspaceOnboardingApps.filter((a) =>
    a.label.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <SetupHeading title="Which apps do you use?">
        Choose the apps you work with. Connect them on the next screen.
      </SetupHeading>
      <div className="ob-search">
        <Search size={16} />
        <input
          placeholder="Search apps"
          aria-label="Search apps"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="ob-app-list" tabIndex={0} aria-label="Apps">
        <div className="ob-app-grid">
          {apps.map((a) => (
            <IntegrationChoiceCard
              key={a.domain}
              integration={{
                domain: a.domain,
                name: a.label,
                description: "",
                kinds: [],
                url: `https://${a.domain}`,
              }}
              compact
              selected={s.draft.selectedApps.includes(a.domain)}
              onClick={() =>
                s.patch({
                  selectedApps: s.draft.selectedApps.includes(a.domain)
                    ? s.draft.selectedApps.filter((id) => id !== a.domain)
                    : [...s.draft.selectedApps, a.domain],
                })
              }
            />
          ))}
        </div>
        {apps.length === 0 ? (
          <p className="ob-empty">No apps match that search.</p>
        ) : null}
      </div>
      <button
        className="ob-primary"
        onClick={() => s.go(s.draft.selectedApps.length ? "plugins" : "team")}
      >
        Continue
        {s.draft.selectedApps.length ? (
          <span className="ob-count">{s.draft.selectedApps.length}</span>
        ) : null}
      </button>
    </>
  );
}
export function InviteTeamScreen({ setup: s }: { setup: WorkspaceSetup }) {
  const [email, setEmail] = useState("");
  const [issue, setIssue] = useState("");
  const add = () => {
    const candidate = email.trim().toLowerCase();
    if (!z.email().safeParse(candidate).success) {
      setIssue("Enter a valid email address.");
      return;
    }
    if (candidate === s.auth.user?.email.toLowerCase()) {
      setIssue("You’re already in this workspace.");
      return;
    }
    if (s.draft.emails.includes(candidate)) {
      setIssue("That email is already on your list.");
      return;
    }
    s.patch({ emails: [...s.draft.emails, candidate] });
    setEmail("");
    setIssue("");
  };
  return (
    <>
      <SetupHeading title="Invite your team">
        Bring the people you work with into your workspace.
      </SetupHeading>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="ob-input-wrap">
          <input
            className="ob-input"
            type="email"
            placeholder="Email address"
            aria-label="Invitation email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setIssue("");
            }}
            disabled={s.draft.emails.length >= 50}
          />
          <button
            className="ob-input-action"
            type="submit"
            disabled={!email.trim() || s.draft.emails.length >= 50}
          >
            <Plus size={14} />
            Add
          </button>
        </div>
      </form>
      {issue ? (
        <p className="ob-error" role="alert">
          {issue}
        </p>
      ) : null}
      {s.draft.emails.length ? (
        <div className="ob-people-list">
          {s.draft.emails.map((address) => (
            <div key={address} className="ob-person">
              <IdentityTile name={address} />
              <span className="ob-row-text">
                <strong>{address}</strong>
                <span>Invitation will be sent when you enter.</span>
              </span>
              <span className="ob-badge">Pending</span>
              <button
                aria-label={`Remove ${address}`}
                className="ob-icon-button"
                onClick={() =>
                  s.patch({
                    emails: s.draft.emails.filter((e) => e !== address),
                  })
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="ob-hint">
          Invitations are sent when you enter your workspace.
        </p>
      )}
      <button className="ob-primary" onClick={() => s.go("invite")}>
        {s.draft.emails.length ? "Continue" : "Skip for now"}
      </button>
    </>
  );
}
function CopyPrompt({
  setup: s,
  compact = false,
}: {
  setup: WorkspaceSetup;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [expiredLink, setExpiredLink] = useState<string | null>(null);
  useEffect(() => {
    if (!s.invite) return;
    const link = s.invite.link;
    const timer = setTimeout(
      () => setExpiredLink(link),
      Math.max(0, Date.parse(s.invite.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [s.invite]);
  const live = s.invite && expiredLink !== s.invite.link;
  const copy = () =>
    void s.run(async () => {
      if (!live || !s.invite || Date.parse(s.invite.expiresAt) <= Date.now())
        throw new Error("Create a new invitation first.");
      await navigator.clipboard.writeText(
        setupPrompt(s.invite.link, s.profile?.username),
      );
      setCopied(true);
    });
  if (compact)
    return (
      <button
        className="ob-secondary"
        disabled={s.busy}
        onClick={() => (live ? copy() : void s.createInvite())}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {live ? (copied ? "Copied" : "Copy setup prompt") : "New setup prompt"}
      </button>
    );
  return (
    <div className="ob-prompt">
      <div className="ob-prompt-header">
        <span>Setup prompt</span>
        <button
          className="ob-secondary"
          disabled={s.busy}
          onClick={() => (live ? copy() : void s.createInvite())}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {live ? (copied ? "Copied" : "Copy") : "Create invitation"}
        </button>
      </div>
      <div className="ob-prompt-body">
        {live && s.invite ? (
          <pre>{setupPrompt(s.invite.link, s.profile?.username)}</pre>
        ) : (
          <p>
            Create an invitation, then copy the prompt into ChatGPT, Claude or
            an agent on its own device or cloud host.
          </p>
        )}
      </div>
      <div className="ob-prompt-footer">
        <div className="ob-provider-stack">
          {["chatgpt", "claude", "grok"].map((p) => (
            <span key={p}>
              <ProviderIcon provider={p} className="size-3.5" />
            </span>
          ))}
        </div>
        <span>Waiting for your agents</span>
        <span className="ob-waiting" aria-hidden="true">
          ···
        </span>
      </div>
    </div>
  );
}
export function InviteAgentsScreen({ setup: s }: { setup: WorkspaceSetup }) {
  return (
    <>
      <SetupHeading title="Invite more agents">
        Copy this prompt into an agent you use. You’ll approve its request here.
      </SetupHeading>
      <CopyPrompt setup={s} />
      <button
        className="ob-primary"
        onClick={() =>
          s.go(s.agents.length || s.requests.length ? "approve" : "success")
        }
      >
        {s.agents.length || s.requests.length
          ? "Review agents"
          : "Skip for now"}
      </button>
    </>
  );
}
export function ApproveAgentsScreen({ setup: s }: { setup: WorkspaceSetup }) {
  return (
    <>
      <SetupHeading title="Approve your agents">
        Agents can join only after you approve them.
      </SetupHeading>
      <div className="ob-field-head">
        <span>Your agents</span>
        <CopyPrompt setup={s} compact />
      </div>
      <div className="ob-people-list">
        {s.requests.map((a) => (
          <div key={a.id} className="ob-person">
            <IdentityTile provider={a.provider} name={a.name} />
            <span className="ob-row-text">
              <strong>{agentName(a.provider, a.name)} requested to join</strong>
              <code>{a.handle}</code>
              <span className="ob-verification">
                Verify with your agent: {a.userCode}
              </span>
            </span>
            <button
              className="ob-secondary"
              onClick={() => void s.decide(a.id, true)}
              disabled={s.busy}
            >
              Approve
            </button>
            <button
              className="ob-icon-button"
              aria-label={`Decline ${a.name}`}
              onClick={() => void s.decide(a.id, false)}
              disabled={s.busy}
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {s.agents.map((a) => (
          <div key={a.id} className="ob-person">
            <IdentityTile provider={a.provider} name={a.name} />
            <span className="ob-row-text">
              <strong>{agentName(a.provider, a.name)}</strong>
              <code>{a.handle}</code>
            </span>
            <span className="ob-connected">Connected</span>
          </div>
        ))}
        {!s.agents.length && !s.requests.length ? (
          <p className="ob-empty">
            No requests yet. Copy the setup prompt to invite an agent.
          </p>
        ) : null}
      </div>
      <p className="ob-hint">
        Approval gives access to #general. You can change access or disconnect
        agents later.
      </p>
      <button
        className="ob-primary"
        disabled={s.busy || s.requests.length > 0}
        onClick={() => s.go("success")}
      >
        Continue
      </button>
    </>
  );
}
/** The workspace's tile on You're in; also preloaded off screen earlier. */
export function WorkspaceLogo({ setup: s }: { setup: WorkspaceSetup }) {
  return (
    <OrgLogo
      name={
        s.draft.purpose === "personal"
          ? (s.auth.user?.name ?? s.draft.name)
          : s.draft.name
      }
      website={s.draft.purpose === "company" ? s.draft.website : undefined}
      className="ob-workspace-avatar"
      transparentWhenLoaded
      logo={s.snapshot?.imageURL}
    />
  );
}

export function SuccessScreen({ setup: s }: { setup: WorkspaceSetup }) {
  return (
    <>
      <SetupHeading title="You’re in.">
        Your workspace is ready. Make yourself at home.
      </SetupHeading>
      <div className="ob-workspace-summary">
        <WorkspaceLogo setup={s} />
        <div>
          <strong>{s.draft.name}</strong>
          <div
            className="ob-avatar-stack"
            aria-label="You, Chief and your connected agents"
          >
            <IdentityTile name={s.auth.user?.name} image={s.auth.user?.image} />
            <span className="ob-avatar ob-chief-avatar" title="Chief">
              <ChiefMark className="size-5" />
            </span>
            {s.agents.map((a, index) => (
              <IdentityTile
                key={a.id}
                stackOrder={28 - index}
                provider={a.provider}
                name={agentName(a.provider, a.name)}
              />
            ))}
          </div>
        </div>
      </div>
      {s.draft.emails.length ? (
        <p className="ob-hint">
          {s.draft.emails.length} team invitation
          {s.draft.emails.length === 1 ? "" : "s"} will be sent when you enter.
        </p>
      ) : null}
      <button
        className="ob-primary"
        disabled={s.busy}
        onClick={() => void s.enter()}
      >
        {s.busy ? (
          <>
            <LoaderCircle size={15} className="animate-spin" />
            {s.activity}
          </>
        ) : (
          "Enter workspace"
        )}
      </button>
    </>
  );
}
