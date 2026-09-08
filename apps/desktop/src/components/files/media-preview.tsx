import { useEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";

import type { WorkspaceFileRecord } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";

import { useRelaySession } from "../../lib/relay-session-context";
import {
  downloadFileBlob,
  fileDownloadName,
  FileTypeIcon,
} from "./file-presentation";

const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
]);

export function MediaPreview({
  file,
  compact = false,
}: {
  file: WorkspaceFileRecord;
  compact?: boolean;
}) {
  const { client } = useRelaySession();
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!compact);
  const [loaded, setMedia] = useState<{
    url: string;
    blob: Blob;
    key: string;
    client: typeof client;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const agentId = file.asset?.agentId;
  const artifactId = file.asset?.artifactId;
  const key = `${agentId}:${artifactId}`;
  const media = loaded?.key === key && loaded.client === client ? loaded : null;
  const inlineImage = imageTypes.has(file.mimeType);
  const automatic = !compact || inlineImage;

  useEffect(() => {
    if (visible || !element.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!client || !agentId || !artifactId || !visible || !automatic) return;
    const controller = new AbortController();
    let url: string | null = null;
    void client
      .loadWorkspaceAsset({ agentId, artifactId }, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setMedia({ url, blob, key, client });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "This file could not be loaded.",
          );
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [client, agentId, artifactId, key, visible, automatic, attempt]);

  return (
    <div
      ref={element}
      className={`relative flex w-full flex-col items-center justify-center overflow-hidden ${compact ? "h-full" : "bg-muted/30 min-h-[420px] gap-6 rounded-xl border p-6"}`}
    >
      {media && inlineImage ? (
        <img
          src={media.url}
          alt={file.name}
          className={
            compact
              ? "h-full w-full object-cover"
              : "max-h-[65vh] max-w-full object-contain"
          }
        />
      ) : media && !compact && file.mimeType.startsWith("video/") ? (
        <video
          src={media.url}
          controls
          preload="metadata"
          className="max-h-[65vh] w-full"
        />
      ) : media && !compact && file.mimeType.startsWith("audio/") ? (
        <>
          <FileTypeIcon
            file={file}
            size={64}
            className="text-muted-foreground/40"
          />
          <audio
            src={media.url}
            controls
            preload="metadata"
            className="w-full max-w-lg"
          />
        </>
      ) : (
        <FileTypeIcon
          file={file}
          size={compact ? 36 : 64}
          strokeWidth={1.1}
          className="text-muted-foreground/40"
        />
      )}
      {!compact && !media && !error ? (
        <Loader2
          size={18}
          className="text-muted-foreground animate-spin"
          aria-label="Loading file"
        />
      ) : null}
      {!compact && error ? (
        <div className="max-w-md text-center">
          <p className="text-destructive text-sm">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              setError(null);
              setMedia(null);
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {!compact && media ? (
        <Button
          variant="outline"
          onClick={() => downloadFileBlob(media.blob, fileDownloadName(file))}
        >
          <Download size={14} /> Download {file.name}
        </Button>
      ) : null}
      {compact && error ? (
        <span className="text-muted-foreground absolute bottom-3 text-[10px]">
          Preview unavailable
        </span>
      ) : null}
      {!compact &&
      media &&
      !inlineImage &&
      !file.mimeType.startsWith("audio/") &&
      !file.mimeType.startsWith("video/") ? (
        <p className="text-muted-foreground text-xs">
          Download this file to open it in another app.
        </p>
      ) : null}
    </div>
  );
}
