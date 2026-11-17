import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Upload } from "lucide-react";

import {
  onboardingAgents,
  usernameIssue,
  workspaceSlug,
} from "@chief/relay-contracts";

import type { WorkspaceSetup } from "./use-setup";
import { InlineAgentName } from "../../components/agents/inline-agent-name";
import { ChiefMark } from "../../components/chief-mark";
import { removeImageAsset, uploadImageAsset } from "../../lib/image-upload";
import {
  loadRelayPluginCatalog,
  peekRelayPluginCatalog,
} from "../../lib/relay-plugin-catalog";
import { useProviderModels } from "../../lib/runtime";
import {
  Field,
  IconSelect,
  IdentityTile,
  placeNote,
  PlacesPicker,
  ProviderIcon,
  purposeOptions,
  SetupHeading,
} from "./elements";
import { localProviderName } from "./model";
import { ScrollList } from "./scroll-list";
import { useUsernameCheck } from "./username-check";

export function ProfileScreen({ setup: s }: { setup: WorkspaceSetup }) {
  const input = useRef<HTMLInputElement>(null);
  const issue = usernameIssue(s.username);
  const check = useUsernameCheck(s.relay.client, s.username);
  const upload = (file: File | undefined) => {
    if (!file) return;
    void s.run(async () => {
      if (!s.relay.client) throw new Error("Chief is reconnecting.");
      await s.auth.updateProfileImage(
        await uploadImageAsset(file, "profile", s.relay.client),
      );
    });
  };
  return (
    <>
      <SetupHeading title="Set up your profile">
        This is how you will appear in your workspace.
      </SetupHeading>
      <div className="ob-profile">
        <IdentityTile
          name={s.auth.user?.name}
          image={s.auth.user?.image}
          className="ob-profile-image"
        />
        <div>
          <button
            className="ob-secondary"
            onClick={() => input.current?.click()}
            disabled={s.busy}
          >
            <Upload size={14} />
            {s.auth.user?.image ? "Change photo" : "Upload photo"}
          </button>
          <p>Choose a photo that feels like you.</p>
          {s.auth.user?.image ? (
            <button
              className="ob-text"
              disabled={s.busy}
              onClick={() =>
                void s.run(async () => {
                  if (!s.relay.client) return;
                  await removeImageAsset("profile", s.relay.client);
                  await s.auth.updateProfileImage(null);
                })
              }
            >
              Remove photo
            </button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          aria-label="Profile photo"
          onChange={(e) => {
            upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <div className="ob-fields">
        <Field label="Name" hint="The name people see in your workspace.">
          <input
            className="ob-input"
            value={s.name}
            onChange={(e) => s.setName(e.target.value)}
            autoComplete="name"
            maxLength={80}
            required
          />
        </Field>
        <Field
          label="Username"
          hint={
            s.username && !issue.ok
              ? issue.message
              : check.state === "taken"
                ? check.message
                : "A short, unique identifier for your account."
          }
        >
          <input
            className="ob-input"
            value={s.username}
            // Strip characters a username cannot contain.
            onChange={(e) =>
              s.setUsername(
                e.target.value.toLowerCase().replace(/[^a-z0-9-]/gu, ""),
              )
            }
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={24}
            required
            aria-invalid={
              (s.username.length > 0 && !issue.ok) || check.state === "taken"
            }
          />
        </Field>
        {check.state === "taken" && check.suggestions.length ? (
          <div className="ob-username-suggestions">
            <span>Try</span>
            {check.suggestions.map((suggestion) => (
              <button
                type="button"
                key={suggestion}
                onClick={() => s.setUsername(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button
        className="ob-primary"
        disabled={
          s.busy || !issue.ok || check.state === "taken" || !s.name.trim()
        }
        onClick={() => void s.saveProfile()}
      >
        Continue
      </button>
    </>
  );
}
export function WorkspaceScreen({ setup: s }: { setup: WorkspaceSetup }) {
  return (
    <>
      <SetupHeading title="Create your workspace">
        A space for you, your team and your agents.
      </SetupHeading>
      <div className="ob-fields">
        <Field label="Workspace name">
          <input
            className="ob-input"
            autoComplete="organization"
            value={s.draft.name}
            maxLength={120}
            onChange={(e) =>
              s.patch({
                name: e.target.value,
                slug: s.draft.slugEdited
                  ? s.draft.slug
                  : workspaceSlug(e.target.value).slice(0, 80),
              })
            }
            required
          />
        </Field>
        <Field label="Workspace slug">
          <div className="ob-input-wrap">
            <input
              className="ob-input"
              value={s.draft.slug}
              onChange={(e) =>
                s.patch({
                  slug: workspaceSlug(e.target.value).slice(0, 80),
                  slugEdited: true,
                })
              }
              spellCheck={false}
              autoCapitalize="none"
              required
            />
            <button
              type="button"
              className="ob-input-action"
              disabled={!s.draft.slugEdited}
              onClick={() =>
                s.patch({
                  slugEdited: false,
                  slug: workspaceSlug(s.draft.name).slice(0, 80),
                })
              }
            >
              {s.draft.slugEdited ? "Reset" : "Auto"}
            </button>
          </div>
        </Field>
      </div>
      <button
        className="ob-primary"
        disabled={!s.draft.name.trim() || !s.draft.slug}
        onClick={() => s.go("chief")}
      >
        Continue
      </button>
    </>
  );
}
export function CompanyScreen({ setup: s }: { setup: WorkspaceSetup }) {
  return (
    <>
      <SetupHeading title="Enter your company details">
        Your agents use these details to tailor their work. You can add them
        later.
      </SetupHeading>
      <div className="ob-fields">
        <Field label="Company name">
          <input
            className="ob-input"
            autoComplete="organization"
            value={s.draft.companyName}
            maxLength={120}
            placeholder="Acme"
            onChange={(e) => s.patch({ companyName: e.target.value })}
          />
        </Field>
        <Field label="Website">
          <input
            className="ob-input"
            autoComplete="url"
            value={s.draft.website}
            maxLength={2048}
            placeholder="acme.com"
            onChange={(e) => s.patch({ website: e.target.value })}
          />
        </Field>
      </div>
      <button className="ob-primary" onClick={() => s.go("intro")}>
        Continue
      </button>
    </>
  );
}
/** Where agents run, chosen from two cards that explain each option. */
export function IntroScreen({ setup: s }: { setup: WorkspaceSetup }) {
  return (
    <>
      <SetupHeading title="Where will your agents run?">
        You can change this later.
      </SetupHeading>
      <PlacesPicker
        value={s.draft.location}
        onChange={(location) => s.patch({ location })}
      />
      <p className="ob-hint">{placeNote(s.draft.location)}</p>
      <button className="ob-primary" onClick={() => s.go("connect")}>
        Continue
      </button>
    </>
  );
}
/**
 * The team Chief starts with. The workspace's suggested teammates are listed
 * first and selected by default; any teammate can be renamed and shows its
 * recommended apps.
 */
export function ChiefScreen({ setup: s }: { setup: WorkspaceSetup }) {
  const icons = usePluginIcons();
  const team = [...onboardingAgents].sort(
    (left, right) =>
      Number(right.purpose === s.draft.purpose) -
      Number(left.purpose === s.draft.purpose),
  );
  const toggle = (id: string, on: boolean) =>
    s.patch({
      selectedAgentIds: on
        ? [...s.draft.selectedAgentIds, id]
        : s.draft.selectedAgentIds.filter((entry) => entry !== id),
    });
  const rename = (id: string, name: string) =>
    s.patch({ agentNames: { ...s.draft.agentNames, [id]: name } });
  return (
    <>
      <SetupHeading title="Choose your team">
        Teammates who work alongside Chief. Change them anytime.
      </SetupHeading>
      <div className="ob-segmented" role="radiogroup" aria-label="Workspace">
        {purposeOptions.map((o) => (
          <button
            type="button"
            key={o.value}
            role="radio"
            aria-checked={s.draft.purpose === o.value}
            onClick={() =>
              s.setPurpose(o.value === "company" ? "company" : "personal")
            }
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
      <ScrollList className="ob-team" label="Your team">
        <div className="ob-team-rows">
          {/* Chief is always on the team during setup. */}
          <div className="ob-team-row" data-checked="true">
            <IdentityTile
              color="var(--foreground)"
              name="Chief"
              className="ob-avatar-chief"
            />
            <span className="ob-row-text">
              <strong>Chief</strong>
              <span>Your primary workspace agent.</span>
            </span>
            <input
              type="checkbox"
              aria-label="Chief is always on your team"
              title="Chief is always on your team"
              checked
              disabled
              readOnly
            />
          </div>
          {team.map((agent) => {
            const name = s.draft.agentNames[agent.id] ?? agent.name;
            const checked = s.draft.selectedAgentIds.includes(agent.id);
            return (
              <div
                key={agent.id}
                className="ob-team-row"
                data-checked={checked}
              >
                <IdentityTile color={agent.color} name={agent.name} />
                <span className="ob-row-text">
                  <strong>
                    <InlineAgentName
                      value={name}
                      fallback={agent.name}
                      onChange={(next) => rename(agent.id, next)}
                    />
                  </strong>
                  <span>{agent.description}</span>
                  <span className="ob-app-chips">
                    {agent.apps.map((app) => (
                      <span key={app.slug} className="ob-app-chip">
                        {icons.get(app.slug) ? (
                          <img src={icons.get(app.slug)} alt="" />
                        ) : null}
                        {app.name}
                      </span>
                    ))}
                  </span>
                </span>
                <input
                  type="checkbox"
                  aria-label={`Add ${name}`}
                  checked={checked}
                  onChange={(event) => toggle(agent.id, event.target.checked)}
                />
              </div>
            );
          })}
        </div>
      </ScrollList>
      <button
        className="ob-primary"
        onClick={() =>
          s.go(s.draft.purpose === "company" ? "company" : "intro")
        }
      >
        Continue
      </button>
    </>
  );
}

/** App icons from the plugin catalog, using the cached catalog when available. */
function usePluginIcons() {
  const [catalog, setCatalog] = useState(peekRelayPluginCatalog);
  useEffect(() => {
    if (catalog) return;
    let stopped = false;
    void loadRelayPluginCatalog(false).then(
      (loaded) => {
        if (!stopped) setCatalog(loaded.plugins);
      },
      () => undefined,
    );
    return () => {
      stopped = true;
    };
  }, [catalog]);
  return useMemo(
    () =>
      new Map(
        (catalog ?? []).flatMap((plugin) =>
          plugin.iconUrl ? [[plugin.id, plugin.iconUrl] as const] : [],
        ),
      ),
    [catalog],
  );
}
export function ConnectScreen({ setup: s }: { setup: WorkspaceSetup }) {
  const local = s.draft.location === "device";
  const eve = !local && s.draft.host === "vercel-eve";
  const provider = local ? s.draft.localProvider : s.draft.service;
  const options = local
    ? Object.entries(localProviderName).map(([value, label]) => ({
        value,
        label,
        icon: <ProviderIcon provider={value} />,
      }))
    : [
        {
          value: "vercelAiGateway",
          label: "Vercel AI Gateway",
          icon: <ProviderIcon provider="vercelAiGateway" />,
        },
        {
          value: "opencode",
          label: "OpenCode",
          icon: <ProviderIcon provider="opencode" />,
        },
      ];
  // The app's own list leads with Auto, stored as "auto" in Chief's config.
  const providerModels = useProviderModels(
    local ? s.draft.localProvider : null,
  );
  const listed = providerModels.models;
  const modelOptions = [
    { value: "auto", label: "Auto", icon: null },
    ...listed
      .filter((model) => model.value !== "" && model.value !== "auto")
      .map((model) => ({ value: model.value, label: model.label, icon: null })),
  ];
  return (
    <>
      <SetupHeading title="Connect Chief">
        {local
          ? "Use an agent app you already have on this device."
          : "Choose where Chief runs and the AI it uses."}
      </SetupHeading>
      <div className="ob-connection" aria-hidden="true">
        <span className="ob-connection-tile">
          <ChiefMark className="size-9" />
        </span>
        <span className="ob-connection-line">
          <ArrowRight size={15} />
        </span>
        <span className="ob-connection-tile">
          <ProviderIcon provider={provider} className="size-7" />
        </span>
      </div>
      {!local ? (
        <Field label="Deploy to">
          <IconSelect
            label="Deployment host"
            value={s.draft.host}
            disabled={s.busy}
            onChange={(value) => {
              s.setApiKey("");
              s.patch({
                host: value === "vercel-eve" ? "vercel-eve" : "relay-cell",
                service:
                  value === "vercel-eve" ? "vercelAiGateway" : s.draft.service,
              });
            }}
            options={[
              {
                value: "relay-cell",
                label: "Chief Cloud",
                icon: <ChiefMark className="size-5" />,
              },
              {
                value: "vercel-eve",
                label: "Vercel Eve",
                icon: <ProviderIcon provider="vercelAiGateway" />,
              },
            ]}
          />
        </Field>
      ) : null}
      <Field label={local ? "Agent app" : "Inference provider"}>
        <IconSelect
          label={local ? "Agent app" : "Inference provider"}
          value={provider}
          onChange={(value) => {
            s.setApiKey("");
            if (local) {
              if (
                value === "codex" ||
                value === "claude" ||
                value === "opencode"
              )
                s.patch({ localProvider: value, localModel: "auto" });
            } else if (value === "vercelAiGateway" || value === "opencode")
              s.patch({ service: value });
          }}
          options={options}
          disabled={s.busy || eve}
        />
      </Field>
      {local ? (
        <>
          <Field
            label="Model"
            hint={
              providerModels.loading
                ? `Finding your ${s.providerName} models…`
                : undefined
            }
          >
            <IconSelect
              label="Model"
              value={s.draft.localModel}
              onChange={(value) => s.patch({ localModel: value })}
              options={modelOptions}
              disabled={s.busy}
            />
          </Field>
          {providerModels.error ? (
            <p className="ob-hint">
              Couldn’t load your {s.providerName} models.{" "}
              <button
                type="button"
                className="ob-inline-action"
                onClick={providerModels.retry}
              >
                Try again
              </button>
            </p>
          ) : null}
          <p className="ob-hint">{placeNote("device")}</p>
        </>
      ) : (
        <>
          <Field
            label={
              s.draft.service === "vercelAiGateway"
                ? "Vercel AI Gateway key"
                : "OpenCode API key"
            }
          >
            <input
              className="ob-input"
              type="password"
              autoComplete="off"
              placeholder={
                eve
                  ? "Provided by Vercel during setup"
                  : s.hasSavedKey
                    ? "Key saved securely · paste to replace"
                    : "Paste your key"
              }
              value={eve ? "" : s.apiKey}
              disabled={s.busy || eve}
              onChange={(e) => s.setApiKey(e.target.value)}
            />
          </Field>
          {eve ? (
            <p className="ob-link">
              You’ll connect AI Gateway through Vercel next.
            </p>
          ) : (
            <a
              className="ob-link"
              target="_blank"
              rel="noreferrer"
              href={
                s.draft.service === "vercelAiGateway"
                  ? "https://vercel.com/d?to=%2F%5Bteam%5D%2F~%2Fai-gateway%2Fapi-keys"
                  : "https://opencode.ai/auth"
              }
            >
              Get an API key ↗
            </a>
          )}
        </>
      )}
      {s.activity ? (
        <p className="ob-activity" role="status">
          <span className="ob-loading-dot" />
          {s.activity}
        </p>
      ) : null}
      <button
        className="ob-primary"
        disabled={
          s.busy ||
          !s.relay.client ||
          (!local &&
            !s.hasSavedKey &&
            s.draft.host !== "vercel-eve" &&
            !s.apiKey.trim())
        }
        onClick={() => void s.connect()}
      >
        {s.busy
          ? "Connecting…"
          : s.draft.workspaceId
            ? "Continue"
            : "Connect Chief"}
      </button>
    </>
  );
}
