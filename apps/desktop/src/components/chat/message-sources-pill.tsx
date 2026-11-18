import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { MessageSource } from "./message-sources";
import { ProviderLogo } from "../provider-logo";

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return url;
  }
}

/**
 * The pages an agent read for an answer, as a quiet pill under it: stacked
 * site marks and a count, opening to the list.
 */
export function MessageSourcesPill({
  sources,
}: {
  sources: readonly MessageSource[];
}) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 max-w-xl">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="hover:bg-muted/60 flex h-7 items-center gap-2 rounded-full pr-2.5 pl-1.5 text-[12px] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_9%,transparent)] transition-colors"
      >
        <span className="flex -space-x-1.5">
          {sources.slice(0, 3).map((source) => (
            <span
              key={source.url}
              className="ring-background flex size-[18px] items-center justify-center rounded-full bg-white ring-2"
            >
              <ProviderLogo
                domain={hostname(source.url)}
                label={hostname(source.url)}
                className="size-3 rounded-[3px] bg-transparent shadow-none"
              />
            </span>
          ))}
        </span>
        {sources.length} {sources.length === 1 ? "source" : "sources"}
      </button>
      {open ? (
        <ol className="mt-2 space-y-0.5">
          {sources.map((source, index) => (
            <li key={source.url}>
              <a
                href={source.url}
                onClick={(event) => {
                  event.preventDefault();
                  void openUrl(source.url);
                }}
                className="hover:bg-muted/50 flex gap-2.5 rounded-lg px-2 py-1.5"
              >
                <span className="text-muted-foreground w-3 pt-0.5 text-[11px] tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[12px] font-medium">
                    <ProviderLogo
                      domain={hostname(source.url)}
                      label={hostname(source.url)}
                      className="size-3.5 shrink-0 rounded-[3px]"
                    />
                    <span className="truncate">
                      {source.title || hostname(source.url)}
                    </span>
                  </span>
                  <span className="text-muted-foreground block truncate text-[12px] leading-4 font-normal">
                    {hostname(source.url)}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
