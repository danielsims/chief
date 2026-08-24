import type { SimpleIcon } from "simple-icons";
import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";

import { cn } from "@chief/ui/lib/utils";

import type { IntegrationSearchResult } from "../lib/integrations";
import type { OnboardingDraft } from "../lib/onboarding-draft";
import type { SocialPlatform } from "../lib/social-platforms";
import type { StepKey } from "./onboarding-options";
import { SOCIAL_PLATFORMS } from "../lib/social-platforms";
import { questions, socialIcons } from "./onboarding-options";

export function BrandIcon({
  icon,
  label,
  className,
}: {
  icon?: SimpleIcon;
  label: string;
  className?: string;
}) {
  if (!icon) {
    return (
      <span
        className={cn(
          "bg-background text-muted-foreground flex h-6 w-6 items-center justify-center rounded-md border text-[10px]",
          className,
        )}
      >
        {label.slice(0, 1)}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "bg-background text-foreground flex h-6 w-6 items-center justify-center rounded-md border",
        className,
      )}
      aria-label={icon.title}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
        <path fill="currentColor" d={icon.path} />
      </svg>
    </span>
  );
}

function useTypedQuestion(text: string, active: boolean) {
  const [visible, setVisible] = useState(() => (active ? "" : text));
  const [complete, setComplete] = useState(!active);

  useEffect(() => {
    if (!active) return;
    let index = 0;
    let timer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      setVisible("");
      setComplete(false);
      timer = window.setInterval(() => {
        index += 1;
        setVisible(text.slice(0, index));
        if (index >= text.length) {
          window.clearInterval(timer);
          setComplete(true);
        }
      }, 18);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [active, text]);

  return { visible, complete };
}

export function AgentBubble({
  text,
  current,
}: {
  text: string;
  current?: boolean;
}) {
  const typed = useTypedQuestion(text, Boolean(current));
  return (
    <div className="flex justify-start">
      <div className="text-foreground max-w-[680px] text-[15px] leading-7">
        {current ? typed.visible : text}
        {current && !typed.complete ? (
          <span className="bg-foreground ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-pulse" />
        ) : null}
      </div>
    </div>
  );
}

export function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="bg-muted/40 text-foreground max-w-[620px] rounded-xl border px-3 py-2 text-sm leading-6">
        {children}
      </div>
    </div>
  );
}

export function EditableAnswer({
  children,
  onEdit,
}: {
  children: React.ReactNode;
  onEdit: () => void;
}) {
  return (
    <div className="group/answer flex flex-col items-end gap-1.5">
      {children}
      <button
        type="button"
        onClick={onEdit}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px] opacity-0 transition-[color,opacity] group-hover/answer:opacity-100 focus-visible:opacity-100"
      >
        <Pencil size={10} />
        Edit
      </button>
    </div>
  );
}

export function UserIndicator({
  user,
  onSignOut,
}: {
  user: {
    name: string;
    email: string;
    image?: string;
  } | null;
  onSignOut: () => void;
}) {
  if (!user) return null;
  const label = user.name.trim() || user.email;
  const initial = label.charAt(0).toUpperCase();

  return (
    <div className="fixed top-10 left-4 z-50 flex items-center gap-2">
      <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border text-[11px] font-medium">
        {user.image ? (
          <img src={user.image} alt="" className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </span>
      <span className="text-muted-foreground max-w-[180px] truncate text-[13px]">
        {label}
      </span>
      <span className="text-muted-foreground/40 text-[13px]">·</span>
      <button
        type="button"
        onClick={onSignOut}
        className="text-muted-foreground hover:text-foreground cursor-pointer text-[13px] transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}

export function SocialIcon({
  label,
  platform,
}: {
  label: string;
  platform?: SocialPlatform;
}) {
  return (
    <BrandIcon
      icon={platform ? socialIcons[platform] : undefined}
      label={label}
    />
  );
}

export function selectedIntegrationNames(
  integrations: IntegrationSearchResult[],
) {
  return integrations.length
    ? integrations.map((integration) => integration.name).join(", ")
    : null;
}

export function modeLabel() {
  return "This Mac";
}

export function questionText(step: StepKey, _draft: OnboardingDraft) {
  return questions[step];
}

export function AnswerPreview({
  step,
  draft,
}: {
  step: StepKey;
  draft: OnboardingDraft;
}) {
  if (step === "mode") {
    return (
      <UserBubble>
        <span className="block font-medium">{modeLabel()}</span>
        <span className="text-muted-foreground">
          Agents use this computer and your existing local agent apps.
        </span>
      </UserBubble>
    );
  }

  if (step === "health") {
    return <UserBubble>Workspace readiness checked</UserBubble>;
  }

  if (step === "context") {
    return (
      <UserBubble>
        <span className="block font-medium">{draft.companyName}</span>
        <span className="text-muted-foreground">{draft.websiteUrl}</span>
      </UserBubble>
    );
  }

  if (step === "brand") {
    return (
      <UserBubble>
        <span className="block font-medium">
          {draft.brand.mode === "research"
            ? "Build it from our website"
            : draft.brand.mode === "upload"
              ? "Use our brand kit"
              : "Skip for now"}
        </span>
        {draft.brand.files.length > 0 ? (
          <span className="text-muted-foreground mt-1 block">
            {draft.brand.files.map((file) => file.name).join(", ")}
          </span>
        ) : null}
      </UserBubble>
    );
  }

  if (step === "socials") {
    const selected = SOCIAL_PLATFORMS.filter(
      (def) => draft.socials[def.platform],
    );
    return (
      <UserBubble>
        {selected.length ? (
          <div className="flex flex-wrap gap-2">
            {selected.map((def) => (
              <span
                key={def.platform}
                className="bg-background inline-flex items-center gap-2 rounded-lg border px-2 py-1"
              >
                <SocialIcon label={def.label} platform={def.platform} />
                {def.prefix}
                {draft.socials[def.platform]}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">No social accounts yet</span>
        )}
      </UserBubble>
    );
  }

  if (step === "inference") {
    const label =
      draft.provider === "codex"
        ? "Codex"
        : draft.provider === "claude"
          ? "Claude"
          : draft.provider === "opencode"
            ? "OpenCode"
            : "Not chosen yet";
    return <UserBubble>{label}</UserBubble>;
  }

  if (step === "selling") {
    return <UserBubble>{draft.goals.selling || "Product not set"}</UserBubble>;
  }

  if (step === "audience") {
    return (
      <UserBubble>{draft.goals.audience || "Audience not set"}</UserBubble>
    );
  }

  if (step === "success") {
    return <UserBubble>{draft.goals.success.join(", ")}</UserBubble>;
  }
  if (step === "time") return <UserBubble>{draft.goals.timeBudget}</UserBubble>;

  if (step === "monitoring") {
    return (
      <UserBubble>
        <div className="flex flex-wrap gap-2">
          {draft.monitoring.channels.map((channel) => (
            <span
              key={channel}
              className="bg-background rounded-lg border px-2 py-1"
            >
              {channel}
            </span>
          ))}
        </div>
        {draft.monitoring.keywords || draft.monitoring.details ? (
          <p className="text-muted-foreground mt-2">
            {draft.monitoring.keywords || draft.monitoring.details}
          </p>
        ) : null}
      </UserBubble>
    );
  }

  if (step === "plugins") {
    return (
      <UserBubble>
        {selectedIntegrationNames(draft.plugins.integrations) ??
          "I'll connect tools later"}
      </UserBubble>
    );
  }

  if (step === "automation") {
    const enabled = draft.automation.plan.filter((item) => item.enabled);
    const modeLabel =
      draft.automation.mode === "automatic"
        ? "Activate automatically"
        : draft.automation.mode === "review"
          ? "Review in Schedule"
          : "Not now";
    return (
      <UserBubble>
        <span className="block font-medium">{modeLabel}</span>
        {enabled.length > 0 && draft.automation.mode !== "manual" ? (
          <span className="text-muted-foreground mt-1 block">
            {enabled.map((item) => item.title).join(", ")}
          </span>
        ) : null}
      </UserBubble>
    );
  }

  return null;
}
