import type { ComponentPropsWithoutRef, ReactNode } from "react";
import {
  Children,
  cloneElement,
  isValidElement,
  lazy,
  Suspense,
  useMemo,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";

import { isJsonString } from "@chief/relay-contracts";

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

const Streamdown = lazy(() =>
  import("streamdown").then((module) => ({ default: module.Streamdown })),
);

function MarkdownLink({
  href,
  children,
  onRepoPath,
  ...props
}: ComponentPropsWithoutRef<"a"> & { onRepoPath?: (path: string) => void }) {
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
        if (target.kind === "repoPath") {
          onRepoPath?.(target.value);
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
  resolveImageSrc,
  ...props
}: ComponentPropsWithoutRef<"img"> & {
  resolveImageSrc?: (src: string) => string;
}) {
  const source = src ? (resolveImageSrc?.(src) ?? src) : src;
  const target = source ? markdownLinkTarget(source) : null;
  const resolved =
    target?.kind === "path" ? convertFileSrc(target.value) : source;
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

function flattenAdjacentText(children: ReactNode): ReactNode[] {
  const flattened: ReactNode[] = [];
  for (const child of Children.toArray(children)) {
    const previous = flattened.at(-1);
    if (isJsonString(child) && isJsonString(previous)) {
      flattened[flattened.length - 1] = `${previous}${child}`;
    } else {
      flattened.push(child);
    }
  }
  return flattened;
}

function highlightReferences(
  children: ReactNode,
  channels: readonly ChannelReferenceTarget[],
  onOpenChannel?: (channelId: string) => void,
  onOpenMention?: (agentId: WorkspaceAgentId) => void,
): ReactNode {
  return flattenAdjacentText(children).map((child, childIndex) =>
    isJsonString(child)
      ? splitSkillReferences(child).map((segment, index) =>
          segment.type === "skill" ? (
            <MessageSkillChip
              id={segment.id}
              key={`${childIndex}:${index}:${segment.id}`}
              label={segment.label}
            />
          ) : (
            <ChannelReferenceText
              channels={channels}
              key={`${childIndex}:${index}:${segment.value}`}
              onOpenChannel={onOpenChannel}
              text={segment.value}
              onOpenMention={onOpenMention}
            />
          ),
        )
      : isValidElement<{ children?: ReactNode }>(child) &&
          child.type !== "code" &&
          child.type !== "a"
        ? cloneElement(child, {
            children: highlightReferences(
              child.props.children,
              channels,
              onOpenChannel,
              onOpenMention,
            ),
          })
        : child,
  );
}

export function StreamingMarkdown({
  children,
  streaming = false,
  channels = [],
  onOpenChannel,
  onOpenMention,
  resolveImageSrc,
  onRepoPath,
}: {
  children: string;
  streaming?: boolean;
  channels?: readonly ChannelReferenceTarget[];
  onOpenChannel?: (channelId: string) => void;
  onOpenMention?: (agentId: WorkspaceAgentId) => void;
  resolveImageSrc?: (src: string) => string;
  onRepoPath?: (path: string) => void;
}) {
  const { inlineText } = messageSkill(children);
  const components = useMemo(
    () => ({
      a: (props: ComponentPropsWithoutRef<"a">) => (
        <MarkdownLink {...props} onRepoPath={onRepoPath} />
      ),
      img: (props: ComponentPropsWithoutRef<"img">) => (
        <MarkdownImage {...props} resolveImageSrc={resolveImageSrc} />
      ),
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
    [channels, onOpenChannel, onOpenMention, onRepoPath, resolveImageSrc],
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
