import { Browser, BrowserDisplayTrigger } from "@browser-ui/react";
import { ArrowRight, Globe2, X } from "lucide-react";

import { normalizeBrowserUrl } from "../../lib/browser-url";
import { useRuntime } from "../../lib/runtime";
import { useTheme } from "../../lib/theme";

function browserDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function BrowserSessionAttachment({
  operating = false,
}: {
  operating?: boolean;
}) {
  const {
    browserConversationId,
    browserStatus,
    browserUrl,
    browserStreamUrl,
    closeBrowser,
    openBrowser,
    reportBrowserUrl,
    reloadBrowser,
    resizeBrowser,
    takeBrowserControl,
  } = useRuntime();
  const { resolved } = useTheme();

  if (!browserUrl || !browserStatus) return null;

  if (browserStatus === "complete") {
    return (
      <button
        type="button"
        onClick={() =>
          openBrowser(browserUrl, browserConversationId ?? undefined)
        }
        className="bg-muted/45 hover:bg-muted/60 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--background)_65%,transparent)] transition-colors"
      >
        <span className="bg-background flex size-8 shrink-0 items-center justify-center rounded-lg shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]">
          <Globe2 aria-hidden size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-xs font-medium">
            Browsing session complete
          </strong>
          <span className="text-muted-foreground mt-0.5 block truncate text-[11px]">
            {browserDomain(browserUrl)}
          </span>
        </span>
        <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
          View session
          <ArrowRight aria-hidden size={12} />
        </span>
      </button>
    );
  }

  return (
    <section className="bg-muted/45 overflow-hidden rounded-2xl p-1 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--background)_70%,transparent)]">
      <div className="flex h-9 items-center gap-2 px-2.5">
        <span className="relative flex size-2 shrink-0">
          {operating ? (
            <span className="bg-foreground/20 absolute inline-flex size-full animate-ping rounded-full motion-reduce:animate-none" />
          ) : null}
          <span className="bg-foreground/65 relative inline-flex size-2 rounded-full" />
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
          {operating ? "Chief is browsing" : "Browser session"}
        </span>
        <span className="text-muted-foreground max-w-1/2 truncate text-[10px]">
          {browserDomain(browserUrl)}
        </span>
      </div>
      <Browser
        ariaLabel="Chief browser session"
        className="chief-browser h-[min(52vh,460px)] min-h-72 w-full overflow-hidden rounded-xl"
        colorScheme={resolved}
        interactive
        operating={operating}
        operatingLabel="Chief is working in this browser"
        streamUrl={browserStreamUrl ?? undefined}
        url={browserUrl}
        variant="bare"
        showControls
        showPictureInPicture
        showFullscreen
        onNavigate={(draftUrl) => {
          const url = normalizeBrowserUrl(draftUrl);
          if (url) openBrowser(url);
        }}
        onReload={reloadBrowser}
        onTakeControl={takeBrowserControl}
        onUrlChange={reportBrowserUrl}
        onViewportResize={resizeBrowser}
        displayControls={
          <BrowserDisplayTrigger
            aria-label="Close browser"
            title="Close browser"
            onClick={closeBrowser}
          >
            <X size={14} />
          </BrowserDisplayTrigger>
        }
      />
    </section>
  );
}
