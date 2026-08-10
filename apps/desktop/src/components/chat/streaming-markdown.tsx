import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Children, lazy, Suspense, useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import {
  markdownLinkTarget,
  normalizeLocalFileLinks,
} from "../../lib/markdown-link-target";
import { AgentMentionText } from "./agent-mention";

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

function MarkdownImage({
  src,
  alt,
  ...props
}: ComponentPropsWithoutRef<"img">) {
  const target = src ? markdownLinkTarget(src) : null;
  const resolved = target?.kind === "path" ? convertFileSrc(target.value) : src;
  return (
    <img
      {...props}
      src={resolved}
      alt={alt ?? ""}
      loading="lazy"
      className="my-5 max-h-[560px] w-full rounded-xl object-contain"
    />
  );
}

function highlightMentions(
  children: ReactNode,
  onOpenMention?: (agentId: WorkspaceAgentId) => void,
) {
  return Children.map(children, (child) =>
    typeof child === "string" ? (
      <AgentMentionText text={child} onOpenMention={onOpenMention} />
    ) : (
      child
    ),
  );
}

export function StreamingMarkdown({
  children,
  streaming = false,
  onOpenMention,
}: {
  children: string;
  streaming?: boolean;
  onOpenMention?: (agentId: WorkspaceAgentId) => void;
}) {
  const components = useMemo(
    () => ({
      a: MarkdownLink,
      img: MarkdownImage,
      p: ({
        children: paragraphChildren,
        ...props
      }: ComponentPropsWithoutRef<"p">) => (
        <p {...props}>{highlightMentions(paragraphChildren, onOpenMention)}</p>
      ),
      li: ({
        children: itemChildren,
        ...props
      }: ComponentPropsWithoutRef<"li">) => (
        <li {...props}>{highlightMentions(itemChildren, onOpenMention)}</li>
      ),
    }),
    [onOpenMention],
  );
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
