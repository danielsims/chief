"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import { cn } from "@chief/ui/lib/utils";

import type { HostSetupDraft, HostTarget } from "../../lib/host-setup";
import type { ProviderId } from "./host-preview";
import {
  canDeployHostSetup,
  cloudflareDeployArgs,
  cloudflareSecretNames,
  defaultHostSetupDraft,
  hostAuthOrigin,
  hostPublicUrl,
  parsePublicHostname,
  parseRelayName,
  providerCallbackUrl,
} from "../../lib/host-setup";
import { ProviderMark, RelayPreview } from "./host-preview";

// The relay has to live in its own repository for the Cloudflare deploy flow to
// build it, so this points at the relay directory of the public repo.
const RELAY_REPO = "https://github.com/danielsims/chief/tree/main/apps/relay";

// Celld and other targets join this list later; each one gets its own row.
const HOSTS: readonly {
  blurb: string;
  deployUrl: string;
  domain: string;
  id: HostTarget;
  label: string;
}[] = [
  {
    blurb: "Runs on Cloudflare Workers.",
    deployUrl: `https://deploy.workers.cloudflare.com/?url=${RELAY_REPO}`,
    domain: "cloudflare.com",
    id: "cloudflare",
    label: "Cloudflare",
  },
];

const STEPS = [
  { heading: "Where should the relay run?", id: "host", label: "Host" },
  { heading: "Name your relay.", id: "name", label: "Name" },
  { heading: "How should people sign in?", id: "signin", label: "Sign-in" },
  { heading: "Want to use your own domain?", id: "domain", label: "Domain" },
  { heading: "Ready to deploy.", id: "deploy", label: "Deploy" },
] as const;

const LEAVE_MS = 150;

const fieldClassName =
  "h-12 rounded-xl bg-background px-4 text-[15px] tracking-[-0.01em] placeholder:text-muted-foreground/60 focus-visible:ring-ring/25";

const hintClassName = "text-muted-foreground mt-3 text-[13px] leading-[1.55]";

export function HostSetup() {
  const [draft, setDraft] = useState<HostSetupDraft>(defaultHostSetupDraft);
  const [stepIndex, setStepIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef<number | null>(null);
  const step = STEPS[stepIndex] ?? STEPS[0];

  const patch = (update: Partial<HostSetupDraft>) =>
    setDraft((current) => ({ ...current, ...update }));

  const slug = parseRelayName(draft.name);
  const nameInvalid = draft.name.trim() !== "" && slug === null;
  const domainInvalid =
    draft.customDomain.trim() !== "" &&
    parsePublicHostname(draft.customDomain) === null;
  const hasProvider =
    (draft.google && draft.googleClientId.trim() !== "") ||
    (draft.apple && draft.appleClientId.trim() !== "");

  const origin = hostAuthOrigin(draft);
  const connectUrl = hostPublicUrl(draft) || origin;
  const named = hostPublicUrl(draft) !== "";

  const canAdvance =
    step.id === "name"
      ? slug !== null
      : step.id === "signin"
        ? hasProvider
        : step.id === "domain"
          ? !domainInvalid
          : false;

  // The host step advances on selection, and an empty domain is skipped rather
  // than confirmed, so neither shows a Continue button.
  const showContinue =
    step.id === "name" ||
    step.id === "signin" ||
    (step.id === "domain" && draft.customDomain.trim() !== "");

  useEffect(
    () => () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    },
    [],
  );

  const goTo = (next: number) => {
    if (leaving || next === stepIndex) return;
    if (next < 0 || next > STEPS.length - 1) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    setLeaving(true);
    leaveTimer.current = window.setTimeout(
      () => {
        setStepIndex(next);
        setLeaving(false);
      },
      reduced ? 0 : LEAVE_MS,
    );
  };

  // Enter advances, except on the last step and while a button or link has
  // focus — those handle their own activation.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (step.id === "deploy" || leaving || !canAdvance) return;
      const target = event.target;
      if (target instanceof Element && target.closest("button, a")) return;
      event.preventDefault();
      goTo(stepIndex + 1);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="mx-auto w-full max-w-[960px]">
      <StepRail
        onSelect={
          leaving
            ? undefined
            : (index) => {
                if (index < stepIndex) goTo(index);
              }
        }
        stepIndex={stepIndex}
      />

      <div className="mt-10 mb-5 flex min-h-[68px] items-end">
        <TypewriterHeading key={step.id} text={step.heading} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div
          className="landing-step bg-card flex min-w-0 flex-col overflow-hidden rounded-3xl"
          data-leaving={leaving}
        >
          <div className="flex-1 p-7 max-md:p-6">
            {step.id === "host" ? (
              <div className="space-y-3">
                {HOSTS.map((host) => (
                  <button
                    className="border-border bg-background hover:border-ring/40 group flex w-full cursor-pointer items-center gap-4 rounded-2xl border p-5 text-left transition-colors"
                    key={host.id}
                    onClick={() => {
                      patch({ host: host.id });
                      goTo(stepIndex + 1);
                    }}
                    type="button"
                  >
                    <Image
                      alt=""
                      className="size-6 shrink-0 rounded-[7px] object-contain"
                      height={24}
                      src={`https://integrations.sh/logo/${host.domain}`}
                      unoptimized
                      width={24}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium">
                        {host.label}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-[13px]">
                        {host.blurb}
                      </span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="text-muted-foreground group-hover:text-foreground shrink-0 transition-colors"
                    >
                      →
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {step.id === "name" ? (
              <label className="block">
                <span className="text-muted-foreground mb-2 block text-xs font-medium">
                  Relay name
                </span>
                <Input
                  aria-invalid={nameInvalid ? true : undefined}
                  autoCapitalize="words"
                  autoComplete="one-time-code"
                  className={fieldClassName}
                  data-1p-ignore
                  data-form-type="other"
                  data-lpignore="true"
                  name="chief-relay-name"
                  onChange={(event) => patch({ name: event.target.value })}
                  placeholder="Acme"
                  value={draft.name}
                />
                {nameInvalid ? (
                  <p className="text-destructive mt-3 text-[13px]">
                    Use 2–40 letters, numbers or dashes.
                  </p>
                ) : null}
              </label>
            ) : null}

            {step.id === "signin" ? (
              <div className="space-y-3">
                <ProviderOption
                  callbackLabel="Return URL"
                  enabled={draft.apple}
                  fieldLabel="Services ID"
                  note="Create a Services ID in Apple Developer and add the return URL to it."
                  onChange={(value) => patch({ appleClientId: value })}
                  onToggle={() => patch({ apple: !draft.apple })}
                  origin={origin}
                  placeholder="sh.example.chief.web"
                  provider="apple"
                  value={draft.appleClientId}
                />
                <ProviderOption
                  callbackLabel="Redirect URI"
                  enabled={draft.google}
                  fieldLabel="Client ID"
                  note="Create a Web application client in Google Cloud and add the redirect URI to it."
                  onChange={(value) => patch({ googleClientId: value })}
                  onToggle={() => patch({ google: !draft.google })}
                  origin={origin}
                  placeholder="1234.apps.googleusercontent.com"
                  provider="google"
                  value={draft.googleClientId}
                />
              </div>
            ) : null}

            {step.id === "domain" ? (
              <>
                <label className="block">
                  <span className="text-muted-foreground mb-2 block text-xs font-medium">
                    Custom domain
                  </span>
                  <Input
                    aria-invalid={domainInvalid ? true : undefined}
                    autoCapitalize="none"
                    autoComplete="off"
                    autoCorrect="off"
                    className={fieldClassName}
                    data-1p-ignore
                    data-form-type="other"
                    data-lpignore="true"
                    name="chief-relay-domain"
                    onChange={(event) =>
                      patch({ customDomain: event.target.value })
                    }
                    placeholder="relay.example.com"
                    spellCheck={false}
                    value={draft.customDomain}
                  />
                </label>
                {draft.customDomain.trim() === "" ? null : domainInvalid ? (
                  <p className="text-destructive mt-3 text-[13px]">
                    Use a hostname you control, without a path or port.
                  </p>
                ) : (
                  <p className={hintClassName}>
                    Point it at your Worker in Cloudflare under Workers →
                    Settings → Domains &amp; Routes.
                  </p>
                )}
              </>
            ) : null}

            {step.id === "deploy" ? (
              <div className="space-y-4">
                {HOSTS.map((host) => (
                  <a
                    className="inline-flex h-12 w-full touch-manipulation items-center justify-center gap-2.5 rounded-xl bg-black text-[15px] font-medium tracking-[-0.02em] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.3)] transition-opacity hover:opacity-90"
                    href={host.deployUrl}
                    key={host.id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <Image
                      alt=""
                      className="size-[18px] shrink-0 rounded-[5px] object-contain"
                      height={18}
                      src={`https://integrations.sh/logo/${host.domain}`}
                      unoptimized
                      width={18}
                    />
                    Deploy to {host.label}
                  </a>
                ))}
                <div className="border-border bg-background rounded-2xl border p-5">
                  <span className="text-muted-foreground text-xs font-medium">
                    Connection → Use a self-hosted relay
                  </span>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <code className="text-foreground min-w-0 font-mono text-[13px] leading-[1.6] break-all">
                      {connectUrl}
                    </code>
                    <CopyButton label="Relay URL" value={connectUrl} />
                  </div>
                  {named ? null : (
                    <p className="text-muted-foreground mt-3 text-[13px] leading-[1.55]">
                      Cloudflare prints the final URL once it deploys.
                    </p>
                  )}
                </div>
                <details>
                  <summary className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer list-none items-center text-[13px] underline-offset-[3px] transition-colors hover:underline [&::-webkit-details-marker]:hidden">
                    Deploy from your terminal
                  </summary>
                  {canDeployHostSetup(draft) ? (
                    <div className="mt-4 space-y-3">
                      <CodeBlock
                        label="Secrets"
                        value={formatSecretCommands(draft)}
                      />
                      <CodeBlock
                        label="Deploy"
                        value={formatDeployCommand(draft)}
                      />
                    </div>
                  ) : null}
                </details>
              </div>
            ) : null}
          </div>

          {step.id === "host" ? null : (
            <div className="border-border flex items-center justify-between gap-3 border-t px-7 py-4 max-md:px-6">
              <Button
                className="h-11 px-4"
                onClick={() => goTo(stepIndex - 1)}
                variant="ghost"
              >
                Back
              </Button>
              <div className="flex items-center gap-1">
                {step.id === "domain" ? (
                  <Button
                    className="h-11 px-4"
                    onClick={() => goTo(stepIndex + 1)}
                    variant="ghost"
                  >
                    Skip
                  </Button>
                ) : null}
                {showContinue ? (
                  <Button
                    className="h-11 px-5"
                    disabled={!canAdvance || leaving}
                    onClick={() => goTo(stepIndex + 1)}
                  >
                    Continue
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <aside className="flex">
          <RelayPreview draft={draft} />
        </aside>
      </div>
    </div>
  );
}

function StepRail({
  onSelect,
  stepIndex,
}: {
  onSelect?: (index: number) => void;
  stepIndex: number;
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      {STEPS.map((entry, index) => {
        const done = index < stepIndex;
        const active = index === stepIndex;
        const label = (
          <>
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-medium",
                done || active
                  ? "bg-white text-neutral-950"
                  : "bg-white/20 text-white",
              )}
            >
              {done ? <CheckIcon /> : index + 1}
            </span>
            <span
              className={cn(
                "text-[12px] font-medium",
                active ? "text-white" : "text-white/75",
                !active && "hidden sm:inline",
              )}
            >
              {entry.label}
            </span>
          </>
        );

        return (
          <div className="flex items-center gap-2" key={entry.id}>
            {index > 0 ? (
              <span
                className={cn(
                  "h-px w-6 shrink-0",
                  done ? "bg-white" : "bg-white/25",
                )}
              />
            ) : null}
            {done && onSelect ? (
              <button
                className="flex cursor-pointer items-center gap-1.5 transition-opacity hover:opacity-70"
                onClick={() => onSelect(index)}
                type="button"
              >
                {label}
              </button>
            ) : (
              <div className="flex items-center gap-1.5">{label}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TypewriterHeading({ text }: { text: string }) {
  return (
    <h2 className="text-foreground m-0 text-[28px] leading-[34px] font-medium tracking-[-0.04em]">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.split("").map((char, index) => (
          <span
            className="landing-char"
            key={`${String(index)}-${char}`}
            style={{ animationDelay: `${String(index * 26)}ms` }}
          >
            {char}
          </span>
        ))}
      </span>
    </h2>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-2.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={3}
      viewBox="0 0 24 24"
    >
      <path d="m5 13 4.5 4.5L19 7" />
    </svg>
  );
}

/**
 * Live spec of the relay being assembled. Nothing here is editable — it is the
 * result of the answers, so the work in progress is always visible.
 */

function ProviderOption({
  callbackLabel,
  enabled,
  fieldLabel,
  note,
  onChange,
  onToggle,
  origin,
  placeholder,
  provider,
  value,
}: {
  callbackLabel: string;
  enabled: boolean;
  fieldLabel: string;
  note: string;
  onChange: (value: string) => void;
  onToggle: () => void;
  origin: string;
  placeholder: string;
  provider: ProviderId;
  value: string;
}) {
  const callbackUrl = origin ? providerCallbackUrl(origin, provider) : "";
  const label = provider === "apple" ? "Apple" : "Google";

  return (
    <div>
      <button
        aria-pressed={enabled}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 rounded-2xl border p-4 text-left transition-colors",
          enabled
            ? "border-foreground bg-background"
            : "border-border bg-background hover:border-ring/40",
        )}
        onClick={onToggle}
        type="button"
      >
        <ProviderMark provider={provider} />
        <span className="text-foreground min-w-0 flex-1 text-[15px] font-medium">
          {label}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-md border transition-colors",
            enabled
              ? "border-foreground bg-foreground text-background"
              : "border-border",
          )}
        >
          {enabled ? <CheckIcon /> : null}
        </span>
      </button>
      {enabled ? (
        <div className="border-border bg-background mt-3 rounded-2xl border p-5">
          <p className="text-muted-foreground text-[13px] leading-[1.55]">
            {note}
          </p>
          <label className="mt-4 block">
            <span className="text-muted-foreground mb-2 block text-xs font-medium">
              {fieldLabel}
            </span>
            <Input
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              className={fieldClassName}
              data-1p-ignore
              data-form-type="other"
              data-lpignore="true"
              name={`chief-${provider}-client-id`}
              onChange={(event) => onChange(event.target.value)}
              placeholder={placeholder}
              spellCheck={false}
              type="text"
              value={value}
            />
          </label>
          {callbackUrl ? (
            <div className="border-border mt-5 border-t pt-4">
              <span className="text-muted-foreground text-xs font-medium">
                {callbackLabel}
              </span>
              <div className="mt-2 flex items-center justify-between gap-3">
                <code className="text-foreground min-w-0 font-mono text-[13px] leading-[1.6] break-all">
                  {callbackUrl}
                </code>
                <CopyButton label={callbackLabel} value={callbackUrl} />
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground mt-4 text-[13px]">
              Name the relay to get this URL.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function shellQuote(value: string): string {
  if (/^[\w./:@+-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function formatSecretCommands(draft: HostSetupDraft): string {
  return [
    "cd apps/relay",
    ...cloudflareSecretNames(draft).map(
      (name) => `wrangler secret put ${name}`,
    ),
  ].join("\n");
}

function formatDeployCommand(draft: HostSetupDraft): string {
  const args = cloudflareDeployArgs(draft);
  const flags: string[] = [];
  for (let index = 0; index + 1 < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === undefined || value === undefined) break;
    flags.push(`${flag} ${shellQuote(value)}`);
  }
  if (flags.length === 0) return "";
  return [
    "cd apps/relay",
    "wrangler deploy \\",
    `  ${flags.join(" \\\n  ")}`,
  ].join("\n");
}

function CodeBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border bg-background rounded-2xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs font-medium tracking-[-0.01em]">
          {label}
        </span>
        <CopyButton label={label} value={value} />
      </div>
      <pre className="text-foreground mt-2 font-mono text-[12.5px] leading-[1.7] break-all whitespace-pre-wrap">
        {value}
      </pre>
    </div>
  );
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      aria-label={`Copy ${label}`}
      className="text-muted-foreground hover:text-foreground inline-flex min-h-11 min-w-11 shrink-0 touch-manipulation items-center justify-end text-xs transition-colors md:min-h-0 md:min-w-0"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          },
          () => undefined,
        );
      }}
      type="button"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
