"use client";

import Image from "next/image";

import { Input } from "@chief/ui/components/input";
import { cn } from "@chief/ui/lib/utils";

import type { HostEmailProvider, HostSetupDraft } from "../../lib/host-setup";

const EMAIL_PROVIDERS: readonly {
  blurb: string;
  domain: string | null;
  id: HostEmailProvider;
  label: string;
}[] = [
  {
    blurb: "Free tier: 100 emails/day, 3,000/month.",
    domain: "resend.com",
    id: "resend",
    label: "Resend",
  },
  {
    blurb: "Workers paid plan; Email Sending must be enabled.",
    domain: "cloudflare.com",
    id: "cloudflare",
    label: "Cloudflare Email Service",
  },
  {
    blurb: "Invitations won’t be emailed until you configure one.",
    domain: null,
    id: "none",
    label: "Set up later",
  },
];

const fieldClassName =
  "h-12 rounded-xl bg-background px-4 text-[15px] tracking-[-0.01em] placeholder:text-muted-foreground/60 focus-visible:ring-ring/25";

export function HostEmailStep({
  draft,
  onPatch,
}: {
  draft: HostSetupDraft;
  onPatch: (update: Partial<HostSetupDraft>) => void;
}) {
  const provider = draft.emailProvider;
  const needsFrom = provider === "resend" || provider === "cloudflare";

  return (
    <div className="space-y-3">
      {EMAIL_PROVIDERS.map((option) => {
        const selected = provider === option.id;
        return (
          <button
            aria-pressed={selected}
            className={cn(
              "flex w-full cursor-pointer items-center gap-4 rounded-2xl border p-4 text-left transition-colors",
              selected
                ? "border-foreground bg-background"
                : "border-border bg-background hover:border-ring/40",
            )}
            key={option.id}
            onClick={() => onPatch({ emailProvider: option.id })}
            type="button"
          >
            {option.domain ? (
              <Image
                alt=""
                className="size-6 shrink-0 rounded-[7px] object-contain"
                height={24}
                src={`https://integrations.sh/logo/${option.domain}`}
                unoptimized
                width={24}
              />
            ) : (
              <span className="border-border text-muted-foreground grid size-6 shrink-0 place-items-center rounded-[7px] border text-xs">
                –
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">
                {option.label}
              </span>
              <span className="text-muted-foreground mt-0.5 block text-[13px]">
                {option.blurb}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full border text-[10px]",
                selected
                  ? "border-foreground bg-foreground text-background"
                  : "border-border",
              )}
            >
              {selected ? "✓" : ""}
            </span>
          </button>
        );
      })}

      {needsFrom ? (
        <div className="border-border bg-background mt-3 space-y-4 rounded-2xl border p-5">
          <label className="block">
            <span className="text-muted-foreground mb-2 block text-xs font-medium">
              From address
            </span>
            <Input
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              className={fieldClassName}
              data-1p-ignore
              data-form-type="other"
              data-lpignore="true"
              name="chief-email-from"
              onChange={(event) =>
                onPatch({ emailFromAddress: event.target.value })
              }
              placeholder="invites@yourdomain.com"
              spellCheck={false}
              type="email"
              value={draft.emailFromAddress}
            />
          </label>

          {provider === "resend" ? (
            <p className="text-muted-foreground text-[13px] leading-[1.55]">
              Create a Resend account, verify this domain, then make an API key.
              After deploying you’ll be prompted to set{" "}
              <code className="font-mono">RESEND_API_KEY</code> as a secret.
            </p>
          ) : (
            <>
              <label className="block">
                <span className="text-muted-foreground mb-2 block text-xs font-medium">
                  Cloudflare account ID
                </span>
                <Input
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect="off"
                  className={fieldClassName}
                  data-1p-ignore
                  data-form-type="other"
                  data-lpignore="true"
                  name="chief-cloudflare-account"
                  onChange={(event) =>
                    onPatch({ cloudflareAccountId: event.target.value })
                  }
                  placeholder="70970470d0caa83dfddefb1a65430a6f"
                  spellCheck={false}
                  value={draft.cloudflareAccountId}
                />
              </label>
              <p className="text-muted-foreground text-[13px] leading-[1.55]">
                Enable Email Sending for this domain in Cloudflare (Workers paid
                plan), then create an API token with Email Sending edit. You’ll
                set{" "}
                <code className="font-mono">CLOUDFLARE_EMAIL_API_TOKEN</code> as
                a secret.
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
