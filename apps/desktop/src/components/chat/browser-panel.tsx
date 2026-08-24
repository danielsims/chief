import type { ErrorInfo, ReactNode, Ref, RefObject } from "react";
import {
  Component,
  lazy,
  memo,
  Suspense,
  useLayoutEffect,
  useState,
} from "react";
import { ArrowRight, Globe2 } from "lucide-react";
import { createPortal } from "react-dom";

import type { BrowserRunRecord } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import { useRuntime } from "../../lib/runtime";
import {
  INLINE_RESULT_CARD_CLASS,
  INLINE_RESULT_ICON_CLASS,
} from "./inline-result-card";

const BrowserSessionViewer = lazy(async () => {
  const module = await import("./browser-session-viewer");
  return { default: module.BrowserSessionViewer };
});

const INLINE_BROWSER_VIEWPORT_CLASS =
  "aspect-[16/10] min-h-0 w-full overflow-hidden rounded-[14px]";

class BrowserSessionErrorBoundary extends Component<
  { children: ReactNode; className?: string; resetKey?: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Chief] Embedded browser render failed", error, info);
  }

  componentDidUpdate(
    previousProps: Readonly<{
      children: ReactNode;
      className?: string;
      resetKey?: string;
    }>,
  ) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        className={cn(
          "bg-muted/45 flex min-h-28 w-full flex-col items-center justify-center rounded-xl px-5 py-6 text-center shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]",
          this.props.className,
        )}
        role="alert"
      >
        <strong className="text-sm font-medium">Browser session paused</strong>
        <span className="text-muted-foreground mt-1 max-w-sm text-xs leading-5">
          The browser could not be displayed, but this conversation and the rest
          of your workspace are still available.
        </span>
      </div>
    );
  }
}

function BrowserSessionLoading({ className }: { className?: string }) {
  return (
    <div
      aria-label="Loading browser viewer"
      className={cn(
        "bg-muted/45 text-muted-foreground flex min-h-28 w-full items-center justify-center rounded-xl text-xs",
        className,
      )}
      role="status"
    >
      Opening browser…
    </div>
  );
}

function SafeBrowserSessionViewer({
  className,
  onCloseViewer,
  operating,
  pictureInPictureAvoidRefs,
  pictureInPictureContainerRef,
  runId,
}: {
  className?: string;
  onCloseViewer?: () => void;
  operating: boolean;
  pictureInPictureAvoidRefs?: readonly RefObject<HTMLElement | null>[];
  pictureInPictureContainerRef?: RefObject<HTMLElement | null>;
  runId: string;
}) {
  return (
    <BrowserSessionErrorBoundary className={className} resetKey={runId}>
      <Suspense fallback={<BrowserSessionLoading className={className} />}>
        <BrowserSessionViewer
          className={className}
          onCloseViewer={onCloseViewer}
          operating={operating}
          pictureInPictureAvoidRefs={pictureInPictureAvoidRefs}
          pictureInPictureContainerRef={pictureInPictureContainerRef}
          runId={runId}
        />
      </Suspense>
    </BrowserSessionErrorBoundary>
  );
}

function browserDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function browserFavicon(url: string) {
  try {
    return new URL("/favicon.ico", url).toString();
  } catch {
    return null;
  }
}

function BrowserFavicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const favicon = browserFavicon(url);

  return (
    <span className={INLINE_RESULT_ICON_CLASS}>
      {favicon && !failed ? (
        <img
          alt=""
          className="size-[18px] rounded-[4px] object-contain"
          src={favicon}
          onError={() => setFailed(true)}
        />
      ) : (
        <Globe2 aria-hidden className="text-muted-foreground" size={15} />
      )}
    </span>
  );
}

function BrowserSessionCard({
  detail,
  onClick,
  title,
  url,
}: {
  detail: string;
  onClick?: () => void;
  title: string;
  url: string;
}) {
  return (
    <div className={INLINE_RESULT_CARD_CLASS}>
      <BrowserFavicon key={url} url={url} />
      <div className="min-w-0 flex-1">
        <strong className="block truncate text-[13px] leading-5 font-medium">
          {title}
        </strong>
        <span className="text-muted-foreground block truncate text-xs leading-4">
          {detail}
        </span>
      </div>
      <div className="relative z-10 flex shrink-0 items-center gap-1">
        {onClick ? (
          <button
            aria-label="Reopen browsing session"
            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/30 flex size-7 items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-2"
            title="Reopen browsing session"
            type="button"
            onClick={onClick}
          >
            <ArrowRight aria-hidden size={14} strokeWidth={1.7} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function BrowserSessionAttachmentContent({
  detached = false,
  onOpenPanel,
  operating = false,
  pictureInPictureAvoidRefs,
  pictureInPictureContainerRef,
  run,
  targetRef,
}: {
  detached?: boolean;
  onOpenPanel?: () => void;
  operating?: boolean;
  pictureInPictureAvoidRefs?: readonly RefObject<HTMLElement | null>[];
  pictureInPictureContainerRef?: RefObject<HTMLElement | null>;
  run: BrowserRunRecord;
  targetRef?: Ref<HTMLDivElement>;
}) {
  const { browserSessions, openBrowser } = useRuntime();
  const session = browserSessions[run.id];
  const url = session?.url ?? run.url;

  if (!url) return null;

  const viewSession = () => {
    if (!session || session.status === "complete") {
      openBrowser(url, run.conversationId, {
        browserRunId: run.id,
        ...(run.threadRootId ? { threadRootId: run.threadRootId } : undefined),
        ...(run.anchorMessageId
          ? { anchorMessageId: run.anchorMessageId }
          : undefined),
      });
    }
    onOpenPanel?.();
  };

  if (!session || session.status === "complete" || detached) {
    return (
      <BrowserSessionCard
        detail={browserDomain(url)}
        onClick={viewSession}
        title={
          detached ? "Browser open in side panel" : "Browsing session complete"
        }
        url={url}
      />
    );
  }

  return (
    <div className="chief-browser-attachment mt-1 w-full max-w-[64rem] min-w-0 overflow-visible">
      <div
        className={cn(
          "chief-browser-attachment-shell",
          targetRef
            ? "bg-muted/45 overflow-hidden rounded-2xl p-1 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--background)_70%,transparent)]"
            : "overflow-visible",
        )}
      >
        {targetRef ? (
          <div
            ref={targetRef}
            className={cn(
              "chief-browser-viewport-target",
              INLINE_BROWSER_VIEWPORT_CLASS,
            )}
          />
        ) : (
          <SafeBrowserSessionViewer
            className={INLINE_BROWSER_VIEWPORT_CLASS}
            operating={operating}
            pictureInPictureAvoidRefs={pictureInPictureAvoidRefs}
            pictureInPictureContainerRef={pictureInPictureContainerRef}
            runId={run.id}
          />
        )}
      </div>
    </div>
  );
}

function BrowserSessionAttachmentImpl(
  props: Parameters<typeof BrowserSessionAttachmentContent>[0],
) {
  return (
    <BrowserSessionErrorBoundary
      className={INLINE_BROWSER_VIEWPORT_CLASS}
      resetKey={props.run.id}
    >
      <BrowserSessionAttachmentContent {...props} />
    </BrowserSessionErrorBoundary>
  );
}

/**
 * Memoized so unrelated chat re-renders (tool progress, streaming text) do not
 * remount the browser viewer and reconnect its stream — that remount is what
 * made the thread flicker and the browser vanish while the agent kept working.
 */
export const BrowserSessionAttachment = memo(
  BrowserSessionAttachmentImpl,
  (prev, next) => {
    if (prev.operating !== next.operating) return false;
    if (prev.detached !== next.detached) return false;
    const prevRun = prev.run.id;
    const nextRun = next.run.id;
    if (prevRun !== nextRun) return false;
    if (prev.onOpenPanel !== next.onOpenPanel) return false;
    if (prev.pictureInPictureAvoidRefs !== next.pictureInPictureAvoidRefs)
      return false;
    if (prev.pictureInPictureContainerRef !== next.pictureInPictureContainerRef)
      return false;
    if (prev.targetRef !== next.targetRef) return false;
    return true;
  },
);

export function BrowserSessionPortal({
  fullscreenTarget,
  onCloseViewer,
  operating = false,
  panelOpen = false,
  runId,
}: {
  fullscreenTarget: HTMLElement | null;
  onCloseViewer?: () => void;
  operating?: boolean;
  panelOpen?: boolean;
  runId: string;
}) {
  const [dock] = useState(() => {
    const element = document.createElement("div");
    element.className =
      "chief-browser-dock h-full min-h-0 w-full overflow-hidden";
    return element;
  });

  useLayoutEffect(() => {
    if (fullscreenTarget) fullscreenTarget.appendChild(dock);
    return () => {
      if (dock.parentElement === fullscreenTarget) dock.remove();
    };
  }, [dock, fullscreenTarget]);

  return createPortal(
    <BrowserSessionErrorBoundary
      className="h-full rounded-none"
      resetKey={runId}
    >
      <SafeBrowserSessionViewer
        className={cn(
          "h-full min-h-0",
          panelOpen ? "rounded-none" : "rounded-xl",
        )}
        onCloseViewer={onCloseViewer}
        operating={operating}
        runId={runId}
      />
    </BrowserSessionErrorBoundary>,
    dock,
  );
}
