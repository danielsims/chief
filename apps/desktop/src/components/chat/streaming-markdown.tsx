import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Children, lazy, Suspense, useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import type { ChannelReferenceTarget } from "./channel-reference-parser";
import { normalizeChiefNavigationLinks } from "../../lib/app-navigation";
import { useChiefNavigation } from "../../lib/chief-navigation-context";
import {
  markdownLinkTarget,
  normalizeLocalFileLinks,
} from "../../lib/markdown-link-target";
import { ChannelReferenceText } from "./channel-reference";
import {
  messageSkill,
  MessageSkillChip,
  splitSkillReferences,
} from "./message-skill-chip";

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
  const navigation = useChiefNavigation();
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        if (!href) return;
        const target = markdownLinkTarget(href);
        if (!target) return;
        if (target.kind === "app") {
          navigation.open(target.value);
          return;
        }
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

function highlightReferences(
  children: ReactNode,
  channels: readonly ChannelReferenceTarget[],
  onOpenChannel?: (channelId: string) => void,
  onOpenMention?: (agentId: WorkspaceAgentId) => void,
) {
  return Children.map(children, (child) =>
    typeof child === "string"
      ? splitSkillReferences(child).map((segment, index) =>
          segment.type === "skill" ? (
            <MessageSkillChip
              id={segment.id}
              key={`${index}:${segment.id}`}
              label={segment.label}
            />
          ) : (
            <ChannelReferenceText
              channels={channels}
              key={`${index}:${segment.value}`}
              onOpenChannel={onOpenChannel}
              text={segment.value}
              onOpenMention={onOpenMention}
            />
          ),
        )
      : child,
  );
}

export function StreamingMarkdown({
  children,
  streaming = false,
  channels = [],
  onOpenChannel,
  onOpenMention,
}: {
  children: string;
  streaming?: boolean;
  channels?: readonly ChannelReferenceTarget[];
  onOpenChannel?: (channelId: string) => void;
  onOpenMention?: (agentId: WorkspaceAgentId) => void;
}) {
  const { inlineText } = messageSkill(children);
  const components = useMemo(
    () => ({
      a: MarkdownLink,
      img: MarkdownImage,
      p: ({
        children: paragraphChildren,
        ...props
      }: ComponentPropsWithoutRef<"p">) => (
        <p {...props}>
          {highlightReferences(
            paragraphChildren,
            channels,
            onOpenChannel,
            onOpenMention,
          )}
        </p>
      ),
      li: ({
        children: itemChildren,
        ...props
      }: ComponentPropsWithoutRef<"li">) => (
        <li {...props}>
          {highlightReferences(
            itemChildren,
            channels,
            onOpenChannel,
            onOpenMention,
          )}
        </li>
      ),
    }),
    [channels, onOpenChannel, onOpenMention],
  );
  return (
    <div className="max-w-full min-w-0 overflow-hidden [overflow-wrap:anywhere] [&_a]:break-all [&_code]:break-all [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
      <Suspense
        fallback={
          <div className="max-w-full [overflow-wrap:anywhere] break-all whitespace-pre-wrap">
            {highlightReferences(
              inlineText,
              channels,
              onOpenChannel,
              onOpenMention,
            )}
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
          {normalizeLocalFileLinks(normalizeChiefNavigationLinks(inlineText))}
        </Streamdown>
      </Suspense>
    </div>
  );
}
