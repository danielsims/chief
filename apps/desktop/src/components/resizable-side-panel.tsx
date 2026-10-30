import type { PointerEventHandler, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@chief/ui/lib/utils";

import { workspaceCardClassName } from "./workspace-content-surface";

const DEFAULT_PANEL_WIDTH = 380;
const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 720;

export interface ResizableSidePanelSizing {
  canReset: boolean;
  onResetWidth: () => void;
  onResizeStart: PointerEventHandler<HTMLButtonElement>;
  widthPx: number;
}

/** A right-hand card that resizes from its left edge, like a thread panel. */
export function useResizableSidePanelSizing({
  storageKey,
  defaultWidth = DEFAULT_PANEL_WIDTH,
  minWidth = MIN_PANEL_WIDTH,
  maxWidth = MAX_PANEL_WIDTH,
}: {
  storageKey: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}): ResizableSidePanelSizing {
  const clamp = useCallback(
    (width: number) => {
      const viewportMaximum = Math.max(
        maxWidth,
        globalThis.window.innerWidth - minWidth,
      );
      return Math.max(minWidth, Math.min(viewportMaximum, width));
    },
    [maxWidth, minWidth],
  );
  const [widthPx, setWidthPx] = useState(() => {
    try {
      const stored = Number.parseInt(
        window.sessionStorage.getItem(storageKey) ?? "",
        10,
      );
      return Number.isFinite(stored) ? clamp(stored) : defaultWidth;
    } catch {
      return defaultWidth;
    }
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, String(widthPx));
    } catch {
      // Keep the in-memory width when storage is unavailable.
    }
  }, [storageKey, widthPx]);

  const onResizeStart = useCallback<PointerEventHandler<HTMLButtonElement>>(
    (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = widthPx;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";

      // The panel follows the pointer directly; React only hears the final
      // width, so the content beside it doesn't re-render every frame.
      const panel = event.currentTarget.parentElement;
      let nextWidth = startWidth;
      const handlePointerMove = (moveEvent: PointerEvent) => {
        nextWidth = clamp(startWidth + startX - moveEvent.clientX);
        if (panel) panel.style.width = `${nextWidth}px`;
        else setWidthPx(nextWidth);
      };
      const handlePointerUp = () => {
        setWidthPx(nextWidth);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", handlePointerMove);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    },
    [clamp, widthPx],
  );

  const onResetWidth = useCallback(
    () => setWidthPx(defaultWidth),
    [defaultWidth],
  );

  return {
    canReset: widthPx !== defaultWidth,
    onResetWidth,
    onResizeStart,
    widthPx,
  };
}

/** The card shell and resize handle; its content decides what it shows. */
export function ResizableSidePanel({
  children,
  className,
  closeLabel = "Close panel",
  fill = false,
  onClose,
  sizing,
}: {
  children: ReactNode;
  className?: string;
  closeLabel?: string;
  /** Takes the remaining width as the main card, e.g. an open session. */
  fill?: boolean;
  onClose?: () => void;
  sizing: ResizableSidePanelSizing;
}) {
  if (fill) {
    return (
      <section
        className={cn(
          workspaceCardClassName,
          "flex min-h-0 min-w-0 flex-1 flex-col",
          className,
        )}
      >
        {children}
      </section>
    );
  }
  return (
    <>
      {onClose ? (
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          className="absolute inset-0 z-30 hidden bg-black/20 max-[900px]:block"
        />
      ) : null}
      <aside
        className={cn(
          workspaceCardClassName,
          "z-40 flex min-h-0 shrink-0 flex-col overflow-visible",
          "max-w-[calc(100vw-300px)] max-[900px]:absolute max-[900px]:inset-y-0 max-[900px]:right-0 max-[900px]:!w-[calc(100%-24px)] max-[900px]:max-w-none max-[900px]:shadow-2xl",
          className,
        )}
        style={{ width: `${sizing.widthPx}px` }}
      >
        <button
          type="button"
          aria-label="Resize panel"
          title={
            sizing.canReset
              ? "Drag to resize. Double-click to reset width."
              : "Drag to resize."
          }
          onPointerDown={sizing.onResizeStart}
          onDoubleClick={sizing.canReset ? sizing.onResetWidth : undefined}
          className="group/resize absolute inset-y-0 -left-3 z-50 w-3 cursor-ew-resize max-[900px]:hidden"
          style={{ cursor: "ew-resize" }}
        >
          {/* Hovering shows only the resize cursor; the line is for keyboard focus. */}
          <span className="bg-border/0 group-focus-visible/resize:bg-border absolute inset-y-4 left-1/2 w-0.5 -translate-x-1/2 rounded-full transition-colors" />
        </button>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
          {children}
        </div>
      </aside>
    </>
  );
}
