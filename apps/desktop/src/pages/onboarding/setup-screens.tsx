import { useRef } from "react";
import { ArrowRight, Cloud, Upload } from "lucide-react";

import {
  onboardingAgents,
  usernameIssue,
  workspaceSlug,
} from "@chief/relay-contracts";

import type { WorkspaceSetup } from "./use-setup";
import { ChiefMark } from "../../components/chief-mark";
import { removeImageAsset, uploadImageAsset } from "../../lib/image-upload";
import {
  Field,
  IconSelect,
  IdentityTile,
  locationOptions,
  PlacesIllustration,
  ProviderIcon,
  purposeOptions,
  SetupHeading,
} from "./elements";
import { localProviderName } from "./model";

export function ProfileScreen({ setup: s }: { setup: WorkspaceSetup }) {
  const input = useRef<HTMLInputElement>(null);
  const issue = usernameIssue(s.username);
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
      <Field
        label="Username"
        hint="3–24 lowercase letters, numbers or hyphens."
      >
        <input
          className="ob-input"
          value={s.username}
          onChange={(e) => s.setUsername(e.target.value.toLowerCase())}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={24}
          required
          aria-invalid={s.username.length > 0 && !issue.ok}
        />
      </Field>
      <button
        className="ob-primary"
        disabled={s.busy || !issue.ok}
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
        <fieldset>
          <legend className="ob-field-label">Who is it for?</legend>
          <div className="ob-choices">
            {purposeOptions.map((o) => (
              <button
                type="button"
                key={o.value}
                role="radio"
                aria-checked={s.draft.purpose === o.value}
                onClick={() =>
                  s.setPurpose(o.value === "company" ? "company" : "personal")
                }
                className="ob-choice"
              >
                {o.icon}
                <span>{o.label}</span>
                <span className="ob-radio">
                  {s.draft.purpose === o.value ? <span /> : null}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <button
        className="ob-primary"
        disabled={!s.draft.name.trim() || !s.draft.slug}
        onClick={() =>
          s.go(s.draft.purpose === "company" ? "company" : "intro")
        }
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
export function IntroScreen({ setup: s }: { setup: WorkspaceSetup }) {
  return (
    <>
      <SetupHeading title="On your device. Or in the cloud.">
        Chief can work from this computer or the cloud.
      </SetupHeading>
      <PlacesIllustration />
      <button className="ob-primary" onClick={() => s.go("chief")}>
        Continue
      </button>
    </>
  );
}
export function ChiefScreen({ setup: s }: { setup: WorkspaceSetup }) {
  const team = onboardingAgents.filter((a) => a.purpose === s.draft.purpose);
  return (
    <>
      <SetupHeading title="Set up Chief">
        Choose where Chief works and who works alongside it.
      </SetupHeading>
      <Field
        label="Run Chief"
        hint={
          s.draft.location === "device"
            ? "Keep this device awake and online while Chief is working."
            : "Chief stays available while you’re away from your device."
        }
      >
        <IconSelect
          label="Run Chief"
          value={s.draft.location}
          onChange={(value) =>
            s.patch({ location: value === "cloud" ? "cloud" : "device" })
          }
          options={locationOptions}
        />
      </Field>
      <div>
        <div className="ob-field-head">
          <span>Your team</span>
          <span>Chief + {s.draft.selectedAgentIds.length} teammates</span>
        </div>
        <div
          className="ob-team-list"
          tabIndex={0}
          aria-label="Choose Chief’s teammates"
        >
          {team.map((a) => (
            <label key={a.id} className="ob-team-row">
              <IdentityTile color={a.color} name={a.name} />
              <span className="ob-row-text">
                <strong>{a.name}</strong>
                <span>{a.description}</span>
              </span>
              <input
                type="checkbox"
                checked={s.draft.selectedAgentIds.includes(a.id)}
                onChange={(e) =>
                  s.patch({
                    selectedAgentIds: e.target.checked
                      ? [...s.draft.selectedAgentIds, a.id]
                      : s.draft.selectedAgentIds.filter((id) => id !== a.id),
                  })
                }
              />
            </label>
          ))}
        </div>
      </div>
      <button className="ob-primary" onClick={() => s.go("connect")}>
        Continue
      </button>
    </>
  );
}
export function ConnectScreen({ setup: s }: { setup: WorkspaceSetup }) {
  const local = s.draft.location === "device";
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
  return (
    <>
      <SetupHeading title="Connect Chief">
        {local
          ? "Use an agent app you already have on this device."
          : "Cloud agents need an AI service to do its work. Paste the key for yours."}
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
      <Field label={local ? "Agent app" : "AI service"}>
        <IconSelect
          label={local ? "Agent app" : "AI service"}
          value={provider}
          onChange={(value) => {
            s.setApiKey("");
            if (local) {
              if (
                value === "codex" ||
                value === "claude" ||
                value === "opencode"
              )
                s.patch({ localProvider: value });
            } else if (value === "vercelAiGateway" || value === "opencode")
              s.patch({ service: value });
          }}
          options={options}
          disabled={
            (!local && !!s.draft.workspaceId) ||
            s.busy ||
            (!local && s.draft.host === "vercel-eve")
          }
        />
      </Field>
      {local ? (
        <p className="ob-hint">
          Keep this device awake and online while Chief is working.
        </p>
      ) : (
        <>
          {s.draft.host === "relay-cell" ? (
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
                    s.draft.workspaceId
                      ? "Key saved securely"
                      : "Paste your key"
                  }
                  value={s.apiKey}
                  disabled={!!s.draft.workspaceId || s.busy}
                  onChange={(e) => s.setApiKey(e.target.value)}
                />
              </Field>
              {!s.draft.workspaceId ? (
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
              ) : null}
            </>
          ) : (
            <p className="ob-hint">
              Connect your Vercel account on the next screen. Chief will use
              your project’s AI Gateway.
            </p>
          )}
          <details className="ob-advanced">
            <summary>Other cloud options</summary>
            <Field label="Deploy to">
              <IconSelect
                label="Cloud host"
                value={s.draft.host}
                disabled={!!s.draft.workspaceId || s.busy}
                onChange={(value) => {
                  s.setApiKey("");
                  s.patch({
                    host: value === "vercel-eve" ? "vercel-eve" : "relay-cell",
                    service:
                      value === "vercel-eve"
                        ? "vercelAiGateway"
                        : s.draft.service,
                  });
                }}
                options={[
                  {
                    value: "relay-cell",
                    label: "Chief Cloud",
                    icon: <Cloud size={17} />,
                  },
                  {
                    value: "vercel-eve",
                    label: "Vercel Eve",
                    icon: <ProviderIcon provider="vercelAiGateway" />,
                  },
                ]}
              />
            </Field>
          </details>
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
            !s.draft.workspaceId &&
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
