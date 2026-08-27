import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { OpenCode } from "@lobehub/icons";
import { ArrowLeft, Check, Server } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";

import { ChiefMark } from "../components/chief-mark";
import {
  ProviderOption,
  workspaceOnboardingAppLogo,
  workspaceOnboardingApps,
} from "./workspace-create-options";

export function CreateForm({
  name,
  website,
  provider,
  apiKey,
  selectedApps,
  working,
  connected,
  hosting,
  relayUrl,
  relayConnected,
  error,
  step,
  onNameChange,
  onWebsiteChange,
  onChiefCloud,
  onSelfHosted,
  onProviderChange,
  onApiKeyChange,
  onSelectedAppsChange,
  onStepChange,
  onBackToHome,
  onSubmit,
}: {
  name: string;
  website: string;
  provider: "claude" | "codex" | "opencode" | null;
  apiKey: string;
  selectedApps: ReadonlySet<string>;
  working: boolean;
  connected: boolean;
  hosting: "chief-cloud" | "self-hosted";
  relayUrl: string;
  relayConnected: boolean;
  error: string | null;
  step: number;
  onNameChange: (value: string) => void;
  onWebsiteChange: (value: string) => void;
  onChiefCloud: () => void;
  onSelfHosted: () => void;
  onProviderChange: (value: "claude" | "codex" | "opencode") => void;
  onApiKeyChange: (value: string) => void;
  onSelectedAppsChange: (value: Set<string>) => void;
  onStepChange: (value: number) => void;
  onBackToHome: () => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const appListRef = useRef<HTMLDivElement>(null);
  const [canScrollApps, setCanScrollApps] = useState(false);
  const updateAppScrollCue = useCallback(() => {
    const element = appListRef.current;
    setCanScrollApps(
      Boolean(
        element &&
        element.scrollHeight - element.scrollTop - element.clientHeight > 4,
      ),
    );
  }, []);
  useEffect(() => {
    if (step !== 3) return;
    const frame = requestAnimationFrame(updateAppScrollCue);
    window.addEventListener("resize", updateAppScrollCue);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateAppScrollCue);
    };
  }, [step, updateAppScrollCue]);
  const advance = (event: React.FormEvent) => {
    event.preventDefault();
    if (step < 3) {
      onStepChange(step + 1);
      return;
    }
    onSubmit(event);
  };
  const canContinue =
    step === 0
      ? Boolean(name.trim())
      : step === 2
        ? provider !== null &&
          (hosting !== "self-hosted" || Boolean(apiKey.trim()))
        : true;
  const back = () => {
    if (step === 0) onBackToHome();
    else onStepChange(step - 1);
  };

  return (
    <form onSubmit={advance} className="space-y-6">
      <button
        type="button"
        onClick={back}
        disabled={working}
        className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 text-[13px] transition-colors disabled:opacity-50"
      >
        <ArrowLeft size={14} />
        Back
      </button>
      <ArrivingQuestion
        key={step}
        step={step}
        title={
          step === 0
            ? "What’s the name of this workspace?"
            : step === 1
              ? "Where should your agents run?"
              : step === 2
                ? "What inference provider will your agents use?"
                : "What apps do you already use?"
        }
        detail={
          step === 0
            ? "Add a website if there’s one your agents should understand."
            : step === 1
              ? "Each agent stays available on Chief Cloud or infrastructure you control."
              : step === 2
                ? hosting === "self-hosted"
                  ? "Inference runs through OpenCode inside your self-hosted relay."
                  : "Chief Cloud keeps the team available across devices."
                : "Choose the apps your team already uses."
        }
      />

      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={`control-${step}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.24, delay: 0.04, ease: "easeOut" }}
        >
          {step === 0 ? (
            <div className="space-y-4">
              <Field label="Workspace name" htmlFor="new-workspace-name">
                <Input
                  id="new-workspace-name"
                  autoFocus
                  value={name}
                  onChange={(event) => onNameChange(event.target.value)}
                  placeholder="Acme"
                  disabled={working}
                />
              </Field>
              <Field label="Website" optional htmlFor="new-workspace-website">
                <Input
                  id="new-workspace-website"
                  value={website}
                  onChange={(event) => onWebsiteChange(event.target.value)}
                  placeholder="acme.com"
                  disabled={working}
                />
              </Field>
            </div>
          ) : step === 1 ? (
            <div>
              <div className="grid gap-2 sm:grid-cols-2">
                <ProviderOption
                  label="Chief Cloud"
                  selected={hosting === "chief-cloud"}
                  onClick={onChiefCloud}
                  icon={<ChiefMark className="size-7" />}
                />
                <ProviderOption
                  label="Self-hosted"
                  selected={hosting === "self-hosted"}
                  onClick={onSelfHosted}
                  icon={<Server size={27} />}
                />
              </div>
              {hosting === "self-hosted" ? (
                <div className="border-border/70 mt-3 flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">
                      {relayConnected ? "Connected relay" : "Selected relay"}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {relayHost(relayUrl)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={onSelfHosted}
                    className="text-muted-foreground hover:text-foreground shrink-0 text-xs transition-colors"
                  >
                    Change
                  </button>
                </div>
              ) : null}
            </div>
          ) : step === 2 ? (
            <div className="space-y-3">
              <div className="grid gap-2">
                <ProviderOption
                  label="OpenCode"
                  selected={provider === "opencode"}
                  onClick={() => onProviderChange("opencode")}
                  icon={<OpenCode size={27} />}
                />
              </div>
              {provider ? (
                <div>
                  <div className="mt-4">
                    <Field
                      label="OpenCode API key"
                      optional={hosting !== "self-hosted"}
                      htmlFor="cloud-api-key"
                    >
                      <Input
                        id="cloud-api-key"
                        type="password"
                        autoComplete="off"
                        value={apiKey}
                        onChange={(event) => onApiKeyChange(event.target.value)}
                        placeholder="sk-…"
                        disabled={working}
                      />
                      <p className="text-muted-foreground mt-1 text-xs">
                        {hosting === "self-hosted"
                          ? "Required once, encrypted by your relay, and used only by this workspace’s hosted agents."
                          : "Stored encrypted and used only by this workspace’s hosted agents. Skip to use Chief’s shared key."}
                      </p>
                    </Field>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="relative">
              <div
                ref={appListRef}
                onScroll={updateAppScrollCue}
                className="grid max-h-[368px] grid-cols-2 gap-2 overflow-y-auto pr-1 pb-16 sm:grid-cols-3"
              >
                {workspaceOnboardingApps.map((app) => {
                  const selected = selectedApps.has(app.domain);
                  return (
                    <button
                      key={app.domain}
                      type="button"
                      onClick={() => {
                        const next = new Set(selectedApps);
                        if (selected) next.delete(app.domain);
                        else next.add(app.domain);
                        onSelectedAppsChange(next);
                      }}
                      className={`hover:border-foreground/60 flex items-center gap-2 rounded-xl border p-3 text-left transition-colors ${selected ? "border-foreground bg-muted" : "bg-background"}`}
                    >
                      <img
                        src={workspaceOnboardingAppLogo(app.domain)}
                        alt=""
                        loading="eager"
                        decoding="async"
                        className="size-6 rounded-md object-contain"
                      />
                      <span className="min-w-0 truncate text-sm font-medium">
                        {app.label}
                      </span>
                      {selected ? (
                        <Check className="ml-auto shrink-0" size={14} />
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <div
                aria-hidden
                className={`to-background pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent transition-opacity duration-200 ${canScrollApps ? "opacity-100" : "opacity-0"}`}
              />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {error ? (
        <p className="bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-xs leading-5">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end pt-1">
        <Button
          type="submit"
          disabled={!canContinue || working || !connected}
          loading={working && step === 3}
        >
          {step === 3 ? "Enter workspace" : "Continue"}
        </Button>
      </div>
    </form>
  );
}

function relayHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function ArrivingQuestion({
  step,
  title,
  detail,
}: {
  step: number;
  title: string;
  detail: string;
}) {
  const reduceMotion = useReducedMotion();
  const [visibleCharacters, setVisibleCharacters] = useState(
    reduceMotion ? title.length : 0,
  );

  useEffect(() => {
    if (reduceMotion) return;
    let interval: number | undefined;
    const startedAt = window.setTimeout(
      () => {
        interval = window.setInterval(() => {
          setVisibleCharacters((current) => {
            if (current >= title.length) {
              if (interval !== undefined) window.clearInterval(interval);
              return current;
            }
            return current + 1;
          });
        }, 22);
      },
      step === 0 ? 70 : 110,
    );
    return () => {
      window.clearTimeout(startedAt);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [reduceMotion, step, title]);

  const complete = visibleCharacters >= title.length;

  return (
    <div className="mt-1 min-h-[92px]" aria-live="polite">
      <h1
        aria-label={title}
        className="text-[28px] leading-tight font-normal tracking-[-0.035em]"
      >
        <span aria-hidden="true">{title.slice(0, visibleCharacters)}</span>
      </h1>
      <motion.p
        initial={false}
        animate={{ opacity: complete ? 1 : 0, y: complete ? 0 : 3 }}
        transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}
        className="text-muted-foreground mt-2 text-sm leading-6"
      >
        {detail}
      </motion.p>
    </div>
  );
}

export function JoinForm({
  invite,
  preview,
  working,
  connected,
  onInviteChange,
  onPrepare,
  onJoin,
}: {
  invite: string;
  preview: {
    workspaceName: string;
    conversationName: string | null;
  } | null;
  working: boolean;
  connected: boolean;
  onInviteChange: (value: string) => void;
  onPrepare: () => void;
  onJoin: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[32px] leading-tight font-normal tracking-[-0.04em]">
          Join a workspace
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Paste the invitation link you received.
        </p>
      </div>
      {preview ? (
        <div className="border-y py-4">
          <p className="text-sm font-medium">{preview.workspaceName}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            {preview.conversationName
              ? `You’ll join #${preview.conversationName}.`
              : "You’ll join this workspace."}
          </p>
        </div>
      ) : (
        <Field label="Invitation link" htmlFor="workspace-invite">
          <Input
            id="workspace-invite"
            autoFocus
            value={invite}
            onChange={(event) => onInviteChange(event.target.value)}
            placeholder="https://…/invite/…"
            disabled={working}
          />
        </Field>
      )}
      <div className="flex justify-end border-t pt-4">
        <Button
          disabled={!invite.trim() || working || !connected}
          loading={working}
          onClick={preview ? onJoin : onPrepare}
        >
          {preview ? "Join workspace" : "Continue"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  optional = false,
  htmlFor,
  children,
}: {
  label: string;
  optional?: boolean;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="text-[13px] font-medium" htmlFor={htmlFor}>
        {label}
        {optional ? (
          <span className="text-muted-foreground ml-1 font-normal">
            Optional
          </span>
        ) : null}
      </label>
      {children}
    </div>
  );
}
