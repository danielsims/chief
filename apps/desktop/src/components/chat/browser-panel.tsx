import { useRef } from "react";
import { ArrowUpRight, LoaderCircle, RotateCw, X } from "lucide-react";

import { AgentBrowserViewport } from "@chief/browser/react";
import { BrowserSurface } from "@chief/browser/surface";

import { normalizeBrowserUrl } from "../../lib/browser-url";
import { useRuntime } from "../../lib/runtime";
import { BrowserOperatingOverlay } from "./browser-operating-overlay";

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
  const inputRef = useRef<HTMLInputElement>(null);

  if (!browserUrl) return null;

  const navigate = () => {
    const url = normalizeBrowserUrl(inputRef.current?.value ?? "");
    if (url) openBrowser(url);
  };

  return (
    <section className="bg-card flex h-full min-h-0 min-w-0 flex-col border-t lg:border-t-0 lg:border-l">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b px-2">
        <button
          type="button"
          aria-label="Reload page"
          onClick={reloadBrowser}
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center transition-colors"
        >
          <RotateCw size={14} />
        </button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            navigate();
          }}
        >
          <div className="bg-muted/40 flex min-w-0 items-center gap-2 border px-2.5 py-1.5">
            <input
              key={browserUrl}
              ref={inputRef}
              defaultValue={browserUrl}
              spellCheck={false}
              aria-label="Browser address"
              className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-xs outline-none"
            />
            <button
              type="submit"
              aria-label="Open address"
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowUpRight size={14} />
            </button>
          </div>
        </form>
        <button
          type="button"
          aria-label="Close browser"
          onClick={closeBrowser}
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-8 items-center justify-center transition-colors"
        >
          <X size={14} />
        </button>
      </header>
      <BrowserSurface
        className="min-h-0 flex-1 bg-black"
        loading={!browserStreamUrl}
        loadingFallback={
          <div className="flex size-full items-center justify-center bg-black">
            <LoaderCircle
              aria-label="Opening browser"
              size={15}
              className="animate-spin text-white/35"
            />
          </div>
        }
        overlay={
          operating ? (
            <BrowserOperatingOverlay onTakeControl={takeBrowserControl} />
          ) : null
        }
      >
        {browserStreamUrl ? (
          <AgentBrowserViewport
            streamUrl={browserStreamUrl}
            onUrlChange={reportBrowserUrl}
            onViewportResize={resizeBrowser}
            className="size-full overflow-hidden bg-black outline-none"
          />
        ) : (
          <span />
        )}
      </BrowserSurface>
    </section>
  );
}
