import type { BrowserDisplayMode } from "@browser-ui/react";
import type { RefObject } from "react";
import { memo, useState } from "react";
import { Browser, BrowserDisplayTrigger } from "@browser-ui/react";
import { Maximize2, Minimize2, X } from "lucide-react";

import { cn } from "@chief/ui/lib/utils";

import { useRuntime } from "../../lib/runtime";
import { useTheme } from "../../lib/theme";

function BrowserSessionViewerImpl({
  className,
  operating,
  pictureInPictureAvoidRefs,
  pictureInPictureContainerRef,
  runId,
}: {
  className?: string;
  operating: boolean;
  pictureInPictureAvoidRefs?: readonly RefObject<HTMLElement | null>[];
  pictureInPictureContainerRef?: RefObject<HTMLElement | null>;
  runId: string;
}) {
  const {
    browserSessions,
    closeBrowser,
    reportBrowserUrl,
    takeBrowserControl,
  } = useRuntime();
  const { resolved } = useTheme();
  const [displayOverride, setDisplayOverride] = useState<{
    mode: BrowserDisplayMode;
    presentationRevision: number;
  } | null>(null);
  const [windowFullscreen, setWindowFullscreen] = useState(false);
  const session = browserSessions[runId];

  if (!session) return null;

  const displayMode =
    displayOverride?.presentationRevision === session.presentationRevision
      ? displayOverride.mode
      : session.presentation;

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
        onClick={() => closeBrowser(runId)}
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
      layoutId={`chief-browser-${runId}`}
      mode={windowFullscreen ? "fullscreen" : displayMode}
      operating={operating || session.operating}
      operatingLabel={
        session.operatingLabel ?? "Chief is working in this browser"
      }
      showPictureInPicture
      pictureInPicture={
        pictureInPictureContainerRef
          ? {
              avoidRefs: pictureInPictureAvoidRefs,
              containerRef: pictureInPictureContainerRef,
              defaultSnapPoint: "bottom-right",
              inset: 16,
            }
          : undefined
      }
      streamUrl={session.streamUrl}
      url={session.url}
      variant="framed"
      viewportSize={{ width: 1280, height: 800 }}
      onModeChange={(mode) => {
        if (windowFullscreen && mode === "inline") {
          setWindowFullscreen(false);
          return;
        }
        setDisplayOverride({
          mode,
          presentationRevision: session.presentationRevision,
        });
      }}
      onTakeControl={() => takeBrowserControl(runId)}
      onUrlChange={(url) => reportBrowserUrl(runId, url)}
    />
  );
}

export const BrowserSessionViewer = memo(
  BrowserSessionViewerImpl,
  (prev, next) =>
    prev.runId === next.runId &&
    prev.operating === next.operating &&
    prev.pictureInPictureAvoidRefs === next.pictureInPictureAvoidRefs &&
    prev.pictureInPictureContainerRef === next.pictureInPictureContainerRef &&
    prev.className === next.className,
);
