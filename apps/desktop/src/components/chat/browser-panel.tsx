import { Browser, BrowserDisplayTrigger } from "@browser-ui/react";
import { X } from "lucide-react";

import { normalizeBrowserUrl } from "../../lib/browser-url";
import { useRuntime } from "../../lib/runtime";
import { useTheme } from "../../lib/theme";

export function BrowserPanel({ operating = false }: { operating?: boolean }) {
  const {
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

  if (!browserUrl) return null;

  return (
    <section className="bg-card chief-browser-panel flex h-full min-h-0 min-w-0 flex-col border-t lg:border-t-0 lg:border-l">
      <Browser
        ariaLabel="Chief browser session"
        className="chief-browser size-full min-h-0"
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
