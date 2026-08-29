import { useState } from "react";
import { Laptop, Server } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";
import { cn } from "@chief/ui/lib/utils";

import type { OnboardingDraft } from "../lib/onboarding-draft";
import {
  Chip,
  StepFrame,
} from "../components/onboarding/onboarding-step-frame";
import { useProviderModels } from "../lib/runtime";
import { successOptions, timeOptions } from "./onboarding-options";
import { modeLabel } from "./onboarding-presentation";
import { ReadinessRow } from "./onboarding-workspace-controls";

export function HealthControl({
  draft,
  runtimeStatus,
  accountReady,
  onBack,
  onModelChange,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  runtimeStatus: "connecting" | "connected" | "disconnected";
  accountReady: boolean;
  onBack: () => void;
  onModelChange: (model: string) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const providerModels = useProviderModels(draft.provider);
  const providerLabel =
    draft.provider === "codex"
      ? "Codex on this Mac"
      : draft.provider === "claude"
        ? "Claude on this Mac"
        : draft.provider === "opencode"
          ? "OpenCode on this Mac"
          : "No agent app chosen yet";
  const runtimeReady = runtimeStatus === "connected";
  const selectedModelLabel =
    providerModels.models.find((model) => model.value === draft.model)?.label ??
    (draft.model || "Auto");

  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      continueLabel="Continue onboarding"
      actionsLeft={
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
      }
    >
      <div className="bg-background divide-y overflow-hidden rounded-xl border px-4">
        <ReadinessRow
          icon={Server}
          label="Account"
          detail={
            accountReady
              ? "Signed in and ready to save setup."
              : "Still connecting to your account."
          }
          ready={accountReady}
        />
        <ReadinessRow
          icon={Laptop}
          label={modeLabel()}
          detail="Agents will run on this computer using your local agent app."
          ready
        />
        <ReadinessRow
          icon={Server}
          label="Agent app"
          detail={
            <span className="flex flex-wrap items-center gap-2">
              <span>{providerLabel}</span>
              <Select
                value={draft.model || "auto"}
                onValueChange={(value) =>
                  onModelChange(value === "auto" ? "" : value)
                }
              >
                <SelectTrigger
                  className="h-7 w-auto min-w-32 px-2 text-xs"
                  aria-label="Initial review model"
                >
                  {providerModels.loading && providerModels.models.length === 0
                    ? "Loading models..."
                    : selectedModelLabel}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  {providerModels.models
                    .filter((model) => model.value.toLowerCase() !== "auto")
                    .map((model) => (
                      <SelectItem key={model.value} value={model.value}>
                        {model.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </span>
          }
          ready={
            draft.provider === "claude" ||
            draft.provider === "codex" ||
            draft.provider === "opencode"
          }
        />
      </div>
      {!runtimeReady ? (
        <p className="text-muted-foreground mt-4 text-xs leading-5">
          You can finish onboarding while the agent connection comes online.
          Chief will not start the review before onboarding is complete.
        </p>
      ) : null}
    </StepFrame>
  );
}

export function SellingControl({
  draft,
  setGoals,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setGoals: (patch: Partial<OnboardingDraft["goals"]>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      disabled={!draft.goals.selling.trim()}
    >
      <p className="text-muted-foreground mb-4 text-sm leading-6">
        Pick any tools you want Chief to help connect. Your agents will suggest
        the best available plugin in the relevant channel and ask before opening
        sign-in.
      </p>
      <Input
        autoFocus
        value={draft.goals.selling}
        onChange={(event) => setGoals({ selling: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter" && draft.goals.selling.trim()) {
            void onContinue();
          }
        }}
        placeholder="AI marketing agents for early-stage teams"
      />
      <p className="text-muted-foreground mt-3 text-xs leading-5">
        Keep it short. The agents use this as the plain-English version of the
        offer.
      </p>
    </StepFrame>
  );
}

export function AudienceControl({
  draft,
  setGoals,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setGoals: (patch: Partial<OnboardingDraft["goals"]>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      disabled={!draft.goals.audience.trim()}
    >
      <Input
        autoFocus
        value={draft.goals.audience}
        onChange={(event) => setGoals({ audience: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter" && draft.goals.audience.trim()) {
            void onContinue();
          }
        }}
        placeholder="Solo founders who need pipeline but hate manual outreach"
      />
      <p className="text-muted-foreground mt-3 text-xs leading-5">
        A real person or team type is better than a market category.
      </p>
    </StepFrame>
  );
}

export function SuccessControl({
  draft,
  setGoals,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setGoals: (patch: Partial<OnboardingDraft["goals"]>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const customValue =
    draft.goals.success.find((item) => !successOptions.includes(item)) ?? "";
  const [customSuccess, setCustomSuccess] = useState(Boolean(customValue));
  const toggle = (option: string) => {
    setGoals({
      success: draft.goals.success.includes(option)
        ? draft.goals.success.filter((item) => item !== option)
        : [...draft.goals.success, option],
    });
  };

  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      disabled={draft.goals.success.length === 0}
    >
      <p className="text-muted-foreground mb-3 text-xs leading-5">
        Choose every outcome that would make Chief feel worthwhile.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {successOptions.map((option) => (
          <Chip
            key={option}
            selected={draft.goals.success.includes(option)}
            onClick={() => toggle(option)}
          >
            {option}
          </Chip>
        ))}
        <Chip
          selected={customSuccess}
          onClick={() => {
            const next = !customSuccess;
            setCustomSuccess(next);
            if (!next && customValue) {
              setGoals({
                success: draft.goals.success.filter(
                  (item) => item !== customValue,
                ),
              });
            }
          }}
        >
          Something else
        </Chip>
      </div>
      <Input
        className={cn("mt-4", !customSuccess && "hidden")}
        autoFocus={customSuccess}
        value={customValue}
        onChange={(event) => {
          const nextValue = event.target.value;
          const presetValues = draft.goals.success.filter((item) =>
            successOptions.includes(item),
          );
          setGoals({
            success: nextValue ? [...presetValues, nextValue] : presetValues,
          });
        }}
        placeholder="Describe the outcome"
      />
    </StepFrame>
  );
}

export function TimeControl({
  draft,
  setGoals,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setGoals: (patch: Partial<OnboardingDraft["goals"]>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const index = Math.max(0, timeOptions.indexOf(draft.goals.timeBudget));
  return (
    <StepFrame onContinue={onContinue} saving={saving}>
      <div className="px-1 py-3">
        <div className="text-center text-sm font-medium">
          {draft.goals.timeBudget}
        </div>
        <input
          type="range"
          aria-label="Time available each week"
          min={0}
          max={timeOptions.length - 1}
          value={index}
          onChange={(event) =>
            setGoals({ timeBudget: timeOptions[Number(event.target.value)] })
          }
          className="[&::-moz-range-track]:bg-border [&::-webkit-slider-runnable-track]:bg-border mt-3 h-9 w-full cursor-pointer appearance-none bg-transparent accent-white focus-visible:outline-none [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-thumb]:-mt-2 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
        />
        <div className="text-muted-foreground mt-4 flex justify-between text-xs">
          <span>Less</span>
          <span>More</span>
        </div>
      </div>
    </StepFrame>
  );
}
