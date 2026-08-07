import type { BrowserDisplayMode } from "@browser-ui/react";
import { useState } from "react";
import {
  Browser,
  BrowserDisplayTrigger,
  BrowserPictureInPictureTrigger,
} from "@browser-ui/react";
import { Maximize2, Minimize2, X } from "lucide-react";

import { cn } from "@chief/ui/lib/utils";

import { useRuntime } from "../../lib/runtime";
import { useTheme } from "../../lib/theme";

export function BrowserSessionViewer({
  className,
  conversationId,
  onCloseViewer,
  operating,
}: {
  className?: string;
  conversationId: string;
  onCloseViewer?: () => void;
  operating: boolean;
}) {
  const {
    browserSessions,
    closeBrowser,
    reportBrowserUrl,
    takeBrowserControl,
  } = useRuntime();
  const { resolved } = useTheme();
  const [displayMode, setDisplayMode] = useState<BrowserDisplayMode>("inline");
  const [windowFullscreen, setWindowFullscreen] = useState(false);
  const session = browserSessions[conversationId];

  if (!session) return null;

  if (!session.streamUrl) {
    return (
      <div
        aria-label="Opening browser"
        className={cn(
          "bg-muted/45 text-muted-foreground flex w-full items-center justify-center rounded-xl text-xs",
          className,
        )}
        role="status"
      >
        Opening browser…
      </div>
    );
  }

  const displayControls = (
    <>
      <BrowserPictureInPictureTrigger
        aria-label={
          displayMode === "picture-in-picture"
            ? "Return browser inline"
            : "Open browser in picture-in-picture"
        }
        title={
          displayMode === "picture-in-picture"
            ? "Return inline"
            : "Picture-in-picture"
        }
      />
      <BrowserDisplayTrigger
        aria-label={windowFullscreen ? "Exit fullscreen" : "Open fullscreen"}
        onClick={() => setWindowFullscreen((current) => !current)}
        title={windowFullscreen ? "Exit fullscreen" : "Open fullscreen"}
      >
        {windowFullscreen ? (
          <Minimize2 aria-hidden />
        ) : (
          <Maximize2 aria-hidden />
        )}
      </BrowserDisplayTrigger>
      <BrowserDisplayTrigger
        aria-label="Close browser viewer"
        onClick={() => {
          closeBrowser(conversationId);
          onCloseViewer?.();
        }}
        title="Close browser viewer"
      >
        <X aria-hidden />
      </BrowserDisplayTrigger>
    </>
  );

  return (
    <Browser
      ariaLabel="Chief browser session"
      className={cn(
        "chief-browser group/browser w-full overflow-hidden rounded-xl",
        className,
      )}
      colorScheme={resolved}
      displayAspectRatio="16 / 10"
      displayControls={displayControls}
      displayControlsClassName="[&_.bui-display-trigger]:size-7 [&_.bui-display-trigger]:rounded-lg [&_.bui-display-trigger]:border-white/15 [&_.bui-display-trigger]:bg-black/70 [&_.bui-display-trigger]:shadow-sm [&_.bui-display-trigger:hover]:scale-100 [&_.bui-display-trigger:hover]:bg-black/85"
      agentCursor={session.agentCursor ?? undefined}
      interactive
      mode={windowFullscreen ? "fullscreen" : displayMode}
      operating={operating || session.operating}
      operatingLabel={
        session.operatingLabel ?? "Chief is working in this browser"
      }
      showPictureInPicture
      streamUrl={session.streamUrl}
      url={session.url}
      variant="bare"
      viewportSize={{ width: 1280, height: 800 }}
      onModeChange={(mode) => {
        if (windowFullscreen && mode === "inline") {
          setWindowFullscreen(false);
          return;
        }
        setDisplayMode(mode);
      }}
      onTakeControl={() => takeBrowserControl(conversationId)}
      onUrlChange={(url) => reportBrowserUrl(conversationId, url)}
    />
  );
}
