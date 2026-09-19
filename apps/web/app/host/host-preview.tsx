"use client";

import type { ReactNode } from "react";
import Image from "next/image";

import { cn } from "@chief/ui/lib/utils";

import type { HostSetupDraft } from "../../lib/host-setup";
import {
  hostAuthOrigin,
  hostPublicUrl,
  parseRelayName,
} from "../../lib/host-setup";
import { AppleLogo } from "../sign-in/apple-logo";
import { GoogleLogo } from "../sign-in/google-logo";

export type ProviderId = "apple" | "google";

export const HOST_OPTIONS = [
  {
    domain: "cloudflare.com",
    label: "Cloudflare",
  },
] as const;

export function RelayPreview({ draft }: { draft: HostSetupDraft }) {
  const slug = parseRelayName(draft.name);
  const hostname = (hostPublicUrl(draft) || hostAuthOrigin(draft)).replace(
    /^https:\/\//u,
    "",
  );
  const providers = [
    ...(draft.apple ? (["apple"] as const) : []),
    ...(draft.google ? (["google"] as const) : []),
  ];

  return (
    <div className="bg-card flex w-full flex-col rounded-3xl p-7 max-md:p-6">
      <h3 className="text-[13px] font-medium text-white/60">Your relay</h3>

      <PreviewSection label="Host">
        <div className="flex items-center gap-2 text-[13px] text-white">
          <Image
            alt=""
            className="size-5 shrink-0 rounded-[6px] object-contain"
            height={20}
            src={`https://integrations.sh/logo/${HOST_OPTIONS[0].domain}`}
            unoptimized
            width={20}
          />
          {HOST_OPTIONS[0].label}
        </div>
      </PreviewSection>

      <PreviewSection label="Name">
        <p className="text-[15px] font-medium tracking-[-0.02em] text-white">
          {draft.name.trim() || <Empty />}
        </p>
        {slug ? (
          <p className="mt-1.5 font-mono text-xs break-all text-white/60">
            {hostname}
          </p>
        ) : null}
      </PreviewSection>

      <PreviewSection label="Sign-in">
        {providers.length > 0 ? (
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {providers.map((provider) => (
              <li
                className="flex items-center gap-2 text-[13px]"
                key={provider}
              >
                <ProviderMark provider={provider} />
                {provider === "apple" ? "Apple" : "Google"}
              </li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
      </PreviewSection>
    </div>
  );
}

function PreviewSection({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="mt-6 border-t border-white/15 pt-5">
      <h4 className="text-[13px] font-medium text-white/60">{label}</h4>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Empty() {
  return <span className="text-[13px] text-white/40">—</span>;
}

export function ProviderMark({ provider }: { provider: ProviderId }) {
  return (
    <span
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-[6px]",
        provider === "apple"
          ? "bg-black text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]"
          : "bg-white text-[#1f1f1f]",
      )}
    >
      {provider === "apple" ? (
        <AppleLogo className="size-3" />
      ) : (
        <GoogleLogo className="size-3" />
      )}
    </span>
  );
}
