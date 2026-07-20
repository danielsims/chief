import type { ComponentPropsWithoutRef } from "react";
import { lazy, Suspense } from "react";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";

import {
  markdownLinkTarget,
  normalizeLocalFileLinks,
} from "../../lib/markdown-link-target";

// Start loading as soon as the chat bundle is evaluated, but keep Streamdown's
// parser and highlighting code out of the desktop entry chunk.
const streamdownModule = import("streamdown");
const Streamdown = lazy(() =>
  streamdownModule.then((module) => ({ default: module.Streamdown })),
);

function MarkdownLink({
  href,
  children,
  ...props
}: ComponentPropsWithoutRef<"a">) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        if (!href) return;
        const target = markdownLinkTarget(href);
        if (!target) return;
        const result =
          target.kind === "path"
            ? openPath(target.value)
            : openUrl(target.value);
        void result.catch((error) => {
          console.warn("[Markdown] Could not open link", error);
        });
      }}
    >
      {children}
    </a>
  );
}

const components = { a: MarkdownLink };

export function StreamingMarkdown({
  children,
  streaming = false,
}: {
  children: string;
  streaming?: boolean;
}) {
  return (
    <div className="max-w-full min-w-0 overflow-hidden [overflow-wrap:anywhere] [&_a]:break-all [&_code]:break-all [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
      <Suspense
        fallback={
          <div className="max-w-full [overflow-wrap:anywhere] break-all whitespace-pre-wrap">
            {children}
          </div>
        }
      >
        <Streamdown
          animated={streaming}
          className="streamdown-root"
          components={components}
          isAnimating={streaming}
          linkSafety={{ enabled: false }}
        >
          {normalizeLocalFileLinks(children)}
        </Streamdown>
      </Suspense>
    </div>
  );
}
