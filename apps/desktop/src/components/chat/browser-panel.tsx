import type { ErrorInfo, ReactNode, Ref } from "react";
import { Component, lazy, Suspense, useLayoutEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowRight, ExternalLink, Globe2 } from "lucide-react";
import { createPortal } from "react-dom";

import type { BrowserRunRecord } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import { useRuntime } from "../../lib/runtime";

const BrowserSessionViewer = lazy(async () => {
  const module = await import("./browser-session-viewer");
  return { default: module.BrowserSessionViewer };
});

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
  conversationId,
  onCloseViewer,
  operating,
  onOpenPanel,
}: {
  className?: string;
  conversationId: string;
  onCloseViewer?: () => void;
  operating: boolean;
  onOpenPanel?: () => void;
}) {
  return (
    <BrowserSessionErrorBoundary
      className={className}
      resetKey={conversationId}
    >
      <Suspense fallback={<BrowserSessionLoading className={className} />}>
        <BrowserSessionViewer
          className={className}
          conversationId={conversationId}
          onCloseViewer={onCloseViewer}
          operating={operating}
          onOpenPanel={onOpenPanel}
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
    <span className="bg-background flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[9px] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
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
    <div className="bg-muted/30 hover:bg-muted/45 flex w-96 max-w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_9%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--background)_72%,transparent)] transition-colors">
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
        <button
          aria-label="Open in primary browser"
          className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/30 flex size-7 items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-2"
          title="Open in browser"
          type="button"
          onClick={() => void openUrl(url)}
        >
          <ExternalLink aria-hidden size={13} strokeWidth={1.7} />
        </button>
        {onClick ? (
          <button
            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/30 flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] leading-none font-medium transition-colors outline-none focus-visible:ring-2"
            type="button"
            onClick={onClick}
          >
            View session
            <ArrowRight aria-hidden size={12} strokeWidth={1.7} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function BrowserSessionAttachmentContent({
  conversationId,
  detached = false,
  onOpenPanel,
  run,
  targetRef,
}: {
  conversationId: string;
  detached?: boolean;
  onOpenPanel?: () => void;
  operating?: boolean;
  run?: BrowserRunRecord;
  targetRef?: Ref<HTMLDivElement>;
}) {
  const { browserSessions, openBrowser } = useRuntime();
  const currentSession = browserSessions[conversationId];
  const pendingRun = run?.id.startsWith("pending:") === true;
  const session =
    !run || pendingRun || currentSession?.runId === run.id
      ? currentSession
      : undefined;
  const url = session?.url ?? run?.url;

  if (!url) return null;

  const viewSession = () => {
    if (!session || session.status === "complete") {
      openBrowser(url, conversationId, {
        ...(run?.id && !pendingRun ? { browserRunId: run.id } : {}),
        ...(run?.threadRootId ? { threadRootId: run.threadRootId } : {}),
        ...(run?.anchorMessageId
          ? { anchorMessageId: run.anchorMessageId }
          : {}),
      });
    }
    onOpenPanel?.();
  };

  if (!session || session.status === "complete" || detached) {
    return (
      <BrowserSessionCard
        detail={browserDomain(url)}
        onClick={onOpenPanel ? viewSession : undefined}
        title={
          detached ? "Browser open in side panel" : "Browsing session complete"
        }
        url={url}
      />
    );
  }

  return (
    <div className="mt-1 w-full max-w-[64rem] min-w-0 overflow-visible">
      <div className="bg-muted/45 overflow-hidden rounded-2xl p-1 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--background)_70%,transparent)]">
        <div
          ref={targetRef}
          className="chief-browser-viewport-target aspect-[16/10] min-h-0 w-full overflow-hidden rounded-xl"
        />
      </div>
    </div>
  );
}

export function BrowserSessionAttachment(
  props: Parameters<typeof BrowserSessionAttachmentContent>[0],
) {
  return (
    <BrowserSessionErrorBoundary resetKey={props.conversationId}>
      <BrowserSessionAttachmentContent {...props} />
    </BrowserSessionErrorBoundary>
  );
}

export function BrowserSessionPortal({
  conversationId,
  fullscreenTarget,
  onCloseViewer,
  onOpenPanel,
  operating = false,
  panelOpen = false,
}: {
  conversationId: string;
  fullscreenTarget: HTMLElement | null;
  onCloseViewer?: () => void;
  onOpenPanel?: () => void;
  operating?: boolean;
  panelOpen?: boolean;
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
      resetKey={conversationId}
    >
      <SafeBrowserSessionViewer
        className={cn(
          "h-full min-h-0",
          panelOpen ? "rounded-none" : "rounded-xl",
        )}
        conversationId={conversationId}
        onCloseViewer={onCloseViewer}
        operating={operating}
        onOpenPanel={panelOpen ? undefined : onOpenPanel}
      />
    </BrowserSessionErrorBoundary>,
    dock,
  );
}
