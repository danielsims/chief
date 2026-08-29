import { Check } from "lucide-react";

import { Input } from "@chief/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";
import { cn } from "@chief/ui/lib/utils";

import type {
  AutomationMode,
  OnboardingAutomationItem,
  OnboardingDraft,
} from "../lib/onboarding-draft";
import { IntegrationAvatarStack } from "../components/integrations/integration-avatar-stack";
import {
  Chip,
  StepFrame,
} from "../components/onboarding/onboarding-step-frame";
import { getPlaybook } from "../lib/playbook-prompts";
import {
  monitoringOptions,
  scheduleTimeOptions,
  weekDays,
} from "./onboarding-options";
import { SocialIcon } from "./onboarding-presentation";

export function AutomationControl({
  draft,
  setAutomation,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setAutomation: (patch: Partial<OnboardingDraft["automation"]>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const enabledCount = draft.automation.plan.filter(
    (item) => item.enabled,
  ).length;
  const updateItem = (
    playbookId: string,
    patch: Partial<OnboardingAutomationItem>,
  ) => {
    setAutomation({
      plan: draft.automation.plan.map((item) =>
        item.playbookId === playbookId ? { ...item, ...patch } : item,
      ),
    });
  };
  const agentLabels: Record<string, string> = {
    analyst: "Analyst",
    content: "Content Writer",
    prospector: "Prospector",
  };
  const modes: {
    mode: AutomationMode;
    label: string;
    detail: string;
  }[] = [
    {
      mode: "automatic",
      label: "Activate selected",
      detail: "Activate at final completion.",
    },
    {
      mode: "review",
      label: "Save for later",
      detail: "Add to Schedule without activating.",
    },
    {
      mode: "manual",
      label: "Not now",
      detail: "Leave recurring work empty.",
    },
  ];

  return (
    <StepFrame
      onContinue={onContinue}
      saving={saving}
      disabled={draft.automation.mode !== "manual" && enabledCount === 0}
      continueLabel={
        draft.automation.mode === "automatic"
          ? "Activate selected"
          : draft.automation.mode === "review"
            ? "Save selected"
            : "Skip for now"
      }
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {modes.map((option) => (
          <button
            key={option.mode}
            type="button"
            onClick={() => setAutomation({ mode: option.mode })}
            className={cn(
              "bg-background hover:border-foreground rounded-xl border p-3 text-left transition-colors",
              draft.automation.mode === option.mode &&
                "border-foreground bg-accent",
            )}
          >
            <span className="block text-sm font-medium">{option.label}</span>
            <span className="text-muted-foreground mt-1 block text-xs leading-5">
              {option.detail}
            </span>
          </button>
        ))}
      </div>

      {draft.automation.mode !== "manual" ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Recommended recurring work</p>
              <p className="text-muted-foreground mt-1 text-xs leading-5">
                A practical starting point for a new workspace.
              </p>
            </div>
            <span className="text-muted-foreground text-xs">
              {draft.automation.timezone.split("/").at(-1)?.replace(/_/g, " ")}{" "}
              time
            </span>
          </div>
          <div className="bg-background max-h-[360px] divide-y overflow-y-auto rounded-xl border">
            {draft.automation.plan.map((item) => {
              const playbook = getPlaybook(item.playbookId);
              return (
                <div
                  key={item.playbookId}
                  className={cn(
                    "grid gap-4 px-4 py-4 transition-opacity sm:grid-cols-[minmax(0,1fr)_304px] sm:items-center",
                    !item.enabled && "opacity-50",
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <button
                      type="button"
                      aria-pressed={item.enabled}
                      aria-label={`${item.enabled ? "Remove" : "Add"} ${item.title}`}
                      onClick={() =>
                        updateItem(item.playbookId, { enabled: !item.enabled })
                      }
                      className={cn(
                        "border-border/80 bg-background hover:border-foreground/60 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[6px] border text-transparent shadow-[inset_0_1px_0_color-mix(in_srgb,var(--foreground)_4%,transparent)] transition-[border-color,background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:outline-none",
                        item.enabled &&
                          "border-foreground bg-foreground text-background shadow-none",
                      )}
                    >
                      {item.enabled ? <Check size={12} /> : null}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="min-w-0 truncate text-sm font-medium">
                          {item.title}
                        </p>
                        <IntegrationAvatarStack
                          integrations={playbook?.integrations}
                          max={4}
                        />
                      </div>
                      <p className="text-muted-foreground mt-1 text-[11px]">
                        {agentLabels[item.agentId] ?? item.agentId}
                      </p>
                      <p className="text-muted-foreground mt-1.5 text-xs leading-5">
                        {item.purpose}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 pl-8 sm:w-[304px] sm:justify-end sm:pl-0">
                    <Select
                      value={item.frequency}
                      onValueChange={(value) =>
                        updateItem(item.playbookId, {
                          frequency: value === "daily" ? "daily" : "weekly",
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label={`${item.title} frequency`}
                        disabled={!item.enabled}
                        className="bg-background h-8 w-24 text-xs"
                      >
                        <span className="whitespace-nowrap">
                          {item.frequency === "daily" ? "Daily" : "Weekly"}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                      </SelectContent>
                    </Select>
                    {item.frequency === "weekly" ? (
                      <Select
                        value={String(item.day)}
                        onValueChange={(value) =>
                          updateItem(item.playbookId, {
                            day: Number(value),
                          })
                        }
                      >
                        <SelectTrigger
                          aria-label={`${item.title} day`}
                          disabled={!item.enabled}
                          className="bg-background h-8 w-20 text-xs"
                        >
                          <span className="whitespace-nowrap">
                            {weekDays[item.day]?.slice(0, 3)}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          {weekDays.map((day, index) => (
                            <SelectItem key={day} value={String(index)}>
                              {day}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                    <Select
                      value={item.time}
                      onValueChange={(time) =>
                        updateItem(item.playbookId, { time })
                      }
                    >
                      <SelectTrigger
                        aria-label={`${item.title} time`}
                        disabled={!item.enabled}
                        className="bg-background h-8 w-28 text-xs"
                      >
                        <span className="whitespace-nowrap">
                          {scheduleTimeOptions.find(
                            (option) => option.value === item.time,
                          )?.label ?? item.time}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {scheduleTimeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-muted-foreground mt-3 text-xs leading-5">
            This only activates the schedules above. Publishing, outreach and
            spend still need approval.
          </p>
        </div>
      ) : null}
    </StepFrame>
  );
}

export function MonitoringControl({
  draft,
  setMonitoring,
  onContinue,
  saving,
}: {
  draft: OnboardingDraft;
  setMonitoring: (patch: Partial<OnboardingDraft["monitoring"]>) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const toggle = (label: string) => {
    const selected = draft.monitoring.channels.includes(label);
    setMonitoring({
      channels: selected
        ? draft.monitoring.channels.filter((item) => item !== label)
        : [...draft.monitoring.channels, label],
    });
  };

  return (
    <StepFrame onContinue={onContinue} saving={saving}>
      <div className="flex flex-wrap gap-2">
        {monitoringOptions.map(({ key, label, platform, Icon }) => (
          <Chip
            key={key}
            selected={draft.monitoring.channels.includes(label)}
            onClick={() => toggle(label)}
          >
            {platform ? (
              <SocialIcon label={label} platform={platform} />
            ) : (
              <Icon size={15} />
            )}
            {label}
          </Chip>
        ))}
      </div>
      <div className="bg-background mt-5 rounded-xl border p-4">
        <div className="max-w-xl">
          <p className="text-sm font-medium">What should agents look for?</p>
          <p className="text-muted-foreground mt-1.5 text-xs leading-5">
            Add the problems customers describe and competitors worth watching.
            This gives your agents a useful place to start.
          </p>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-[1.15fr_0.85fr]">
          <label htmlFor="monitoring-signals" className="block">
            <span className="text-foreground mb-2 block text-xs font-medium">
              Signals to watch
            </span>
            <Input
              id="monitoring-signals"
              value={draft.monitoring.keywords}
              onChange={(event) =>
                setMonitoring({ keywords: event.target.value })
              }
              placeholder="e.g. slow video editing, content backlog, Descript"
            />
          </label>
          <label htmlFor="monitoring-places" className="block">
            <span className="text-foreground mb-2 block text-xs font-medium">
              Places to focus{" "}
              <span className="text-muted-foreground">(optional)</span>
            </span>
            <Input
              id="monitoring-places"
              value={draft.monitoring.details}
              onChange={(event) =>
                setMonitoring({ details: event.target.value })
              }
              placeholder='e.g. r/VideoEditing, "best video editor"'
            />
          </label>
        </div>
      </div>
    </StepFrame>
  );
}
