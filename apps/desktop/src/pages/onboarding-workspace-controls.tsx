import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Claude, OpenAI, OpenCode } from "@lobehub/icons";
import { CheckCircle2, Laptop } from "lucide-react";

import { parseJsonString } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import { PrefixedInput } from "@chief/ui/components/prefixed-input";
import { cn } from "@chief/ui/lib/utils";

import type {
  OnboardingBrandFile,
  OnboardingDraft,
} from "../lib/onboarding-draft";
import type { SocialPlatform } from "../lib/social-platforms";
import { StepFrame } from "../components/onboarding/onboarding-step-frame";
import { SOCIAL_PLATFORMS } from "../lib/social-platforms";
import { SocialIcon } from "./onboarding-presentation";

export function ModeControl({
  onContinue,
  saving,
}: {
  onContinue: () => void;
  saving: boolean;
}) {
  return (
    <StepFrame onContinue={onContinue} saving={saving}>
      <div className="bg-background flex items-start gap-3 rounded-xl border p-4">
        <span className="bg-background flex size-8 shrink-0 items-center justify-center rounded-lg border">
          <Laptop size={16} />
        </span>
        <span>
          <span className="block text-sm font-medium">This Mac</span>
          <span className="text-muted-foreground mt-1 block text-xs leading-5">
            Chief runs through the local agent app you choose. Work and
            connector secrets stay on this machine.
          </span>
        </span>
      </div>
    </StepFrame>
  );
}

export function ContextControl({
  draft,
  setField,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setField: (patch: Partial<OnboardingDraft>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      disabled={!draft.companyName.trim()}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-muted-foreground text-xs">Company</span>
          <Input
            autoFocus
            value={draft.companyName}
            onChange={(event) => setField({ companyName: event.target.value })}
            placeholder="Acme"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-muted-foreground text-xs">Website</span>
          <Input
            value={draft.websiteUrl}
            onChange={(event) => setField({ websiteUrl: event.target.value })}
            placeholder="acme.com"
          />
        </label>
      </div>
    </StepFrame>
  );
}

export function BrandControl({
  draft,
  setBrand,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setBrand: (patch: Partial<OnboardingDraft["brand"]>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  const choices: {
    mode: OnboardingDraft["brand"]["mode"];
    label: string;
    detail: string;
  }[] = [
    {
      mode: "research",
      label: "Build it for me",
      detail:
        "Chief will study your website and public profiles in the initial review.",
    },
    {
      mode: "upload",
      label: "I have a brand kit",
      detail: "Add guidelines, examples, logos or reference material.",
    },
    {
      mode: "skip",
      label: "Not yet",
      detail: "Continue without a saved brand profile.",
    },
  ];

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const selected = Array.from(files).slice(0, 4);
    const totalBytes = selected.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > 4 * 1024 * 1024) {
      setFileError("Keep the selected files under 4 MB in total.");
      return;
    }
    setFileError(null);
    const encoded = await Promise.all(
      selected.map(
        (file) =>
          new Promise<OnboardingBrandFile>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = parseJsonString(reader.result);
              if (!dataUrl) {
                reject(new Error(`Could not read ${file.name}.`));
                return;
              }
              resolve({
                name: file.name,
                type: file.type || "application/octet-stream",
                dataUrl,
              });
            };
            reader.onerror = () =>
              reject(reader.error ?? new Error(`Could not read ${file.name}.`));
            reader.readAsDataURL(file);
          }),
      ),
    );
    setBrand({ mode: "upload", files: encoded });
  };

  return (
    <StepFrame onContinue={onContinue} saving={saving}>
      <div className="grid gap-2 sm:grid-cols-3">
        {choices.map((choice) => (
          <button
            key={choice.mode}
            type="button"
            onClick={() => setBrand({ mode: choice.mode })}
            className={cn(
              "bg-background hover:border-foreground rounded-xl border p-3 text-left transition-colors",
              draft.brand.mode === choice.mode && "border-foreground bg-accent",
            )}
          >
            <span className="block text-xs font-medium">{choice.label}</span>
            <span className="text-muted-foreground mt-1 block text-[10px] leading-4">
              {choice.detail}
            </span>
          </button>
        ))}
      </div>
      {draft.brand.mode !== "skip" ? (
        <div className="bg-background mt-4 rounded-xl border p-4">
          <label className="text-xs font-medium" htmlFor="brand-notes">
            Anything the agent should preserve
          </label>
          <textarea
            id="brand-notes"
            value={draft.brand.notes}
            onChange={(event) => setBrand({ notes: event.target.value })}
            placeholder="Claims, phrases, visual rules, examples or links"
            className="bg-background placeholder:text-muted-foreground focus:border-foreground mt-2 min-h-20 w-full resize-y rounded-lg border px-3 py-2 text-xs leading-5 outline-none"
          />
          {draft.brand.mode === "upload" ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="bg-foreground text-background hover:bg-foreground/90 inline-flex h-8 cursor-pointer items-center rounded-lg border px-3 text-xs">
                Add files
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.txt,.md,.json,image/*"
                  className="hidden"
                  onChange={(event) => void addFiles(event.target.files)}
                />
              </label>
              <span className="text-muted-foreground text-[10px]">
                Up to four files, 4 MB total
              </span>
            </div>
          ) : null}
          {draft.brand.files.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {draft.brand.files.map((file) => (
                <span
                  key={file.name}
                  className="text-muted-foreground rounded-md border px-2 py-1 text-[10px]"
                >
                  {file.name}
                </span>
              ))}
            </div>
          ) : null}
          {fileError ? (
            <p className="text-destructive mt-2 text-[10px]">{fileError}</p>
          ) : null}
        </div>
      ) : null}
      <p className="text-muted-foreground mt-3 text-[10px] leading-4">
        Chief uses this during the initial business review after onboarding.
      </p>
    </StepFrame>
  );
}

export function SocialsControl({
  draft,
  setSocial,
  onContinue,
  saving,
  ready,
}: {
  draft: OnboardingDraft;
  setSocial: (platform: SocialPlatform, handle: string) => void;
  onContinue: () => void;
  saving: boolean;
  ready: boolean;
}) {
  return (
    <StepFrame onContinue={onContinue} saving={saving} disabled={!ready}>
      <div className="grid gap-3">
        {SOCIAL_PLATFORMS.map((def) => (
          <label
            key={def.platform}
            className="grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-center"
          >
            <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
              <SocialIcon label={def.label} platform={def.platform} />
              {def.label}
            </span>
            <PrefixedInput
              className="overflow-hidden rounded-lg"
              prefix={def.prefix}
              value={draft.socials[def.platform] ?? ""}
              onValueChange={(handle) => setSocial(def.platform, handle)}
              placeholder="handle"
              disabled={!ready}
            />
          </label>
        ))}
      </div>
    </StepFrame>
  );
}

export function ProviderControl({
  draft,
  setField,
  onChangeLocation,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setField: (patch: Partial<OnboardingDraft>) => void;
  onChangeLocation: () => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const agentAppOptionClass = (selected: boolean) =>
    cn(
      "bg-background hover:border-foreground flex h-16 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
      selected && "border-foreground bg-muted",
    );

  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      disabled={
        draft.provider !== "claude" &&
        draft.provider !== "codex" &&
        draft.provider !== "opencode"
      }
      actionsLeft={
        <Button type="button" variant="ghost" onClick={onChangeLocation}>
          Back
        </Button>
      }
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() =>
            setField({ providerMode: "local", provider: "claude", model: "" })
          }
          className={agentAppOptionClass(draft.provider === "claude")}
        >
          <Claude.Color size={32} className="shrink-0" />
          <span className="block text-sm font-medium">Claude</span>
        </button>
        <button
          type="button"
          onClick={() =>
            setField({ providerMode: "local", provider: "codex", model: "" })
          }
          className={agentAppOptionClass(draft.provider === "codex")}
        >
          <OpenAI size={32} className="shrink-0" />
          <span className="block text-sm font-medium">Codex</span>
        </button>
        <button
          type="button"
          onClick={() =>
            setField({
              providerMode: "local",
              provider: "opencode",
              model: "",
            })
          }
          className={agentAppOptionClass(draft.provider === "opencode")}
        >
          <OpenCode size={32} className="shrink-0" />
          <span className="block text-sm font-medium">OpenCode</span>
        </button>
      </div>
    </StepFrame>
  );
}

export function ReadinessRow({
  icon: Icon,
  label,
  detail,
  ready,
}: {
  icon: LucideIcon;
  label: string;
  detail: ReactNode;
  ready: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center",
          ready ? "text-emerald-500" : "text-muted-foreground",
        )}
      >
        {ready ? <CheckCircle2 size={15} /> : <Icon size={15} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="text-muted-foreground mt-1 block text-xs leading-5">
          {detail}
        </span>
      </span>
    </div>
  );
}
