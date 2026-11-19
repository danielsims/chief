import type { BrowserDisplayMode } from "@browser-ui/react";
import type { RefObject } from "react";
import { memo, useCallback, useState } from "react";
import { Browser, BrowserDisplayTrigger } from "@browser-ui/react";
import { Maximize2, Minimize2, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";

import { MatrixLoader } from "@chief/ui/components/matrix-loader";
import { cn } from "@chief/ui/lib/utils";

import { parseRelayError } from "../../lib/relay-runtime-errors";
import { useRelaySession } from "../../lib/relay-session-context";
import { useRuntime } from "../../lib/runtime";
import { useTheme } from "../../lib/theme";

function BrowserSessionViewerImpl({
  className,
  onConnectionError,
  operating,
  pictureInPictureAvoidRefs,
  pictureInPictureContainerRef,
  runId,
}: {
  className?: string;
  onConnectionError: () => void;
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
  const { client: relay } = useRelaySession();
  const [displayOverride, setDisplayOverride] = useState<{
    mode: BrowserDisplayMode;
    presentationRevision: number;
  } | null>(null);
  const [windowFullscreen, setWindowFullscreen] = useState(false);
  // Sound starts off: browsers only play it after a click, and the toggle is one.
  const [soundAvailable, setSoundAvailable] = useState(false);
  const [sound, setSound] = useState(false);
  const session = browserSessions[runId];

  // A machine's browser streams through its own tunnel; each connection
  // takes a fresh one-time ticket from the relay.
  const machineAgent =
    session?.agentId &&
    /^wss:\/\/m-[0-9a-f-]{36}\./u.test(session.streamUrl ?? "")
      ? session.agentId
      : undefined;
  const resolveMachineConnection = useCallback(() => {
    if (!machineAgent || !relay)
      throw new Error("The browser ticket service is unavailable.");
    return relay.createMachineViewerTicket(machineAgent, runId);
  }, [machineAgent, relay, runId]);

  // browser-ui's end-session control: a paired machine's session ends on
  // the machine, through the relay, for the agent's owner; a local one ends
  // here. Either way the card becomes the ended card.
  const endSession = useCallback(async () => {
    if (machineAgent && relay) {
      try {
        await relay.stopMachineBrowser(machineAgent, runId);
      } catch (cause) {
        toast.error(
          parseRelayError(cause).message || "The browser couldn't be stopped.",
        );
        throw cause;
      }
    }
    closeBrowser(runId);
  }, [closeBrowser, machineAgent, relay, runId]);

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
          "bg-muted/45 text-muted-foreground flex w-full items-center justify-center gap-2 rounded-xl text-xs",
          className,
        )}
        role="status"
      >
        <MatrixLoader size={12} ariaLabel="Opening browser" />
        Opening browser…
      </div>
    );
  }

  const displayControls = (
    <>
      {soundAvailable ? (
        <BrowserDisplayTrigger
          aria-label={sound ? "Mute" : "Unmute"}
          aria-pressed={sound}
          onClick={() => setSound((current) => !current)}
          title={sound ? "Mute" : "Unmute"}
        >
          {sound ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
        </BrowserDisplayTrigger>
      ) : null}
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
    </>
  );

  return (
    <Browser
      ariaLabel="Chief browser session"
      autoReconnect={!machineAgent}
      className={cn(
        "chief-browser group/browser w-full overflow-hidden rounded-xl",
        className,
      )}
      colorScheme={resolved}
      displayAspectRatio="16 / 10"
      displayControls={displayControls}
      onEndSession={endSession}
      displayControlsClassName="[&_.bui-display-trigger]:h-7 [&_.bui-display-trigger:not(.bui-end-session)]:w-7 [&_.bui-display-trigger]:rounded-lg [&_.bui-display-trigger]:border-white/15 [&_.bui-display-trigger]:bg-black/70 [&_.bui-display-trigger]:shadow-sm [&_.bui-display-trigger:hover]:scale-100 [&_.bui-display-trigger:hover]:bg-black/85"
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
      sound={sound}
      onSoundAvailable={setSoundAvailable}
      resolveConnection={machineAgent ? resolveMachineConnection : undefined}
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
      onStatusChange={(status) => {
        if (machineAgent && status === "error") onConnectionError();
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
    prev.onConnectionError === next.onConnectionError &&
    prev.pictureInPictureAvoidRefs === next.pictureInPictureAvoidRefs &&
    prev.pictureInPictureContainerRef === next.pictureInPictureContainerRef &&
    prev.className === next.className,
);
