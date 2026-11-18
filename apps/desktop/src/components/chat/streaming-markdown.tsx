import type { ComponentPropsWithoutRef, ReactNode } from "react";
import {
  Children,
  cloneElement,
  isValidElement,
  lazy,
  Suspense,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { z } from "zod";

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

// Streamdown and its Shiki highlighter load with the first message, and code
// blocks use Chief's own light and dark theme.
// The parser extensions other plugins (such as GFM) registered before ours.
const processorDataSchema = z.object({
  micromarkExtensions: z.array(z.looseObject({})).catch([]).default([]),
});

type RemarkPlugin = NonNullable<
  ComponentPropsWithoutRef<
    typeof import("streamdown").Streamdown
  >["remarkPlugins"]
>[number];

// Loaded as the app starts, so the first message, and the highlighter its
// code blocks use, are ready before they're needed.
const streamdownLoaded = Promise.all([
  import("streamdown"),
  import("./code-highlighter"),
]);

const Streamdown = lazy(async () => {
  const [
    { Streamdown: Markdown, defaultRemarkPlugins },
    { chiefCodeHighlighter },
  ] = await streamdownLoaded;
  // Chat has no indented code blocks: an indented line, as text pasted from
  // elsewhere often has, stays text. Fenced blocks are code.
  const withoutIndentedCode: RemarkPlugin = function () {
    const data = this.data();
    Object.assign(data, {
      micromarkExtensions: [
        ...processorDataSchema.parse(data).micromarkExtensions,
        { disable: { null: ["codeIndented"] } },
      ],
    });
  };
  const plugins = { code: chiefCodeHighlighter };
  const remarkPlugins: RemarkPlugin[] = [
    ...Object.values(defaultRemarkPlugins),
    withoutIndentedCode,
  ];
  return {
    default: (props: ComponentPropsWithoutRef<typeof Markdown>) => (
      <Markdown {...props} plugins={plugins} remarkPlugins={remarkPlugins} />
    ),
  };
});

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

/** Handlers that call the latest ones, so their identity never matters. */
function referenceHandlers(latest: {
  readonly current: {
    onOpenChannel?: (channelId: string) => void;
    onOpenMention?: (agentId: WorkspaceAgentId) => void;
  };
}) {
  const { onOpenChannel, onOpenMention } = latest.current;
  return [
    onOpenChannel && ((id: string) => latest.current.onOpenChannel?.(id)),
    onOpenMention &&
      ((id: WorkspaceAgentId) => latest.current.onOpenMention?.(id)),
  ] as const;
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
          child.props.children != null &&
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
  // Renderers are component types: replacing them remounts every paragraph,
  // which discards the text under a selection. Keep them stable and read the
  // latest handlers when they run.
  const latest = useRef({
    onOpenChannel,
    onOpenMention,
    onRepoPath,
    resolveImageSrc,
  });
  useLayoutEffect(() => {
    latest.current = {
      onOpenChannel,
      onOpenMention,
      onRepoPath,
      resolveImageSrc,
    };
  });
  const channelKey = channels.map((channel) => channel.id).join("\0");
  const components = useMemo(
    () => ({
      a: (props: ComponentPropsWithoutRef<"a">) => (
        <MarkdownLink
          {...props}
          onRepoPath={(path) => latest.current.onRepoPath?.(path)}
        />
      ),
      img: (props: ComponentPropsWithoutRef<"img">) => (
        <MarkdownImage
          {...props}
          resolveImageSrc={(src) =>
            latest.current.resolveImageSrc?.(src) ?? src
          }
        />
      ),
      p: ({
        children: paragraphChildren,
        ...props
      }: ComponentPropsWithoutRef<"p">) => (
        <p {...props}>
          {highlightReferences(
            paragraphChildren,
            channels,
            ...referenceHandlers(latest),
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
            ...referenceHandlers(latest),
          )}
        </li>
      ),
    }),
    // The channel list is compared by content, not identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channelKey],
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
