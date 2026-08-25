import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Claude, OpenAI, OpenCode } from "@lobehub/icons";
import { ArrowLeft, Check, Laptop } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@chief/ui/components/select";

import { ChiefMark } from "../components/chief-mark";
import { useProviderModels } from "../lib/runtime";
import {
  ProviderOption,
  workspaceOnboardingAppLogo,
  workspaceOnboardingApps,
} from "./workspace-create-options";

export function CreateForm({
  name,
  website,
  runtime,
  provider,
  model,
  selectedApps,
  working,
  connected,
  step,
  onNameChange,
  onWebsiteChange,
  onRuntimeChange,
  onProviderChange,
  onModelChange,
  onSelectedAppsChange,
  onStepChange,
  onBackToHome,
  onSubmit,
}: {
  name: string;
  website: string;
  runtime: "cloud" | "desktop";
  provider: "claude" | "codex" | "opencode" | null;
  model: string;
  selectedApps: ReadonlySet<string>;
  working: boolean;
  connected: boolean;
  step: number;
  onNameChange: (value: string) => void;
  onWebsiteChange: (value: string) => void;
  onRuntimeChange: (value: "cloud" | "desktop") => void;
  onProviderChange: (value: "claude" | "codex" | "opencode") => void;
  onModelChange: (value: string) => void;
  onSelectedAppsChange: (value: Set<string>) => void;
  onStepChange: (value: number) => void;
  onBackToHome: () => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const providerModels = useProviderModels(provider);
  const models =
    runtime === "cloud"
      ? [
          {
            value: "opencode-go/deepseek-v4-flash",
            label: "DeepSeek V4 Flash",
          },
        ]
      : selectableProviderModels(providerModels.models);
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
    step === 0 ? Boolean(name.trim()) : step === 2 ? provider !== null : true;
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
                ? "What harness will your agents use?"
                : "What apps do you already use?"
        }
        detail={
          step === 0
            ? "Add a website if there’s one your agents should understand."
            : step === 1
              ? "Each agent gets a stable address and runs where you choose."
              : step === 2
                ? runtime === "cloud"
                  ? "Chief Cloud keeps the team available across devices."
                  : "Choose the local agent app and starting model."
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
            <div className="grid gap-2 sm:grid-cols-2">
              <ProviderOption
                label="Chief Cloud"
                selected={runtime === "cloud"}
                onClick={() => onRuntimeChange("cloud")}
                icon={<ChiefMark className="size-7" />}
              />
              <ProviderOption
                label="This Mac"
                selected={runtime === "desktop"}
                onClick={() => onRuntimeChange("desktop")}
                icon={<Laptop size={27} />}
              />
            </div>
          ) : step === 2 ? (
            <div className="space-y-3">
              <div
                className={`grid gap-2 ${runtime === "cloud" ? "sm:grid-cols-1" : "sm:grid-cols-3"}`}
              >
                {runtime === "desktop" ? (
                  <>
                    <ProviderOption
                      label="Codex"
                      selected={provider === "codex"}
                      onClick={() => onProviderChange("codex")}
                      icon={<OpenAI size={27} />}
                    />
                    <ProviderOption
                      label="Claude"
                      selected={provider === "claude"}
                      onClick={() => onProviderChange("claude")}
                      icon={<Claude.Color size={27} />}
                    />
                  </>
                ) : null}
                <ProviderOption
                  label="OpenCode"
                  selected={provider === "opencode"}
                  onClick={() => onProviderChange("opencode")}
                  icon={<OpenCode size={27} />}
                />
              </div>
              {provider ? (
                <div>
                  <Field label="Model" htmlFor="agent-model">
                    <Select value={model} onValueChange={onModelChange}>
                      <SelectTrigger
                        id="agent-model"
                        className="w-full"
                        aria-label="Agent model"
                      >
                        <SelectValue placeholder="Choose model" />
                      </SelectTrigger>
                      <SelectContent>
                        {models.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
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

export function selectableProviderModels<
  T extends { value: string; label: string },
>(models: readonly T[]) {
  const seen = new Set<string>();
  return models.filter((option) => {
    const value = option.value.trim().toLowerCase();
    const label = option.label.trim().toLowerCase();
    if (!value || value === "auto" || label === "auto" || seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}
