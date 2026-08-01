import type { ComponentProps, PointerEventHandler, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

const DEFAULT_PANEL_WIDTH = 380;
const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 720;
const PANEL_WIDTH_STORAGE_KEY = "chief.conversations.auxiliary-panel-width";

function clampPanelWidth(width: number) {
  const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
  const viewportMaximum = Math.max(
    MAX_PANEL_WIDTH,
    viewportWidth - MIN_PANEL_WIDTH,
  );
  return Math.max(MIN_PANEL_WIDTH, Math.min(viewportMaximum, width));
}

export interface ConversationAuxiliaryPanelSizing {
  canReset: boolean;
  onResetWidth: () => void;
  onResizeStart: PointerEventHandler<HTMLButtonElement>;
  widthPx: number;
}

export function useConversationAuxiliaryPanelSizing(): ConversationAuxiliaryPanelSizing {
  const [widthPx, setWidthPx] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_PANEL_WIDTH;
    try {
      const stored = Number.parseInt(
        window.sessionStorage.getItem(PANEL_WIDTH_STORAGE_KEY) ?? "",
        10,
      );
      return Number.isFinite(stored)
        ? clampPanelWidth(stored)
        : DEFAULT_PANEL_WIDTH;
    } catch {
      return DEFAULT_PANEL_WIDTH;
    }
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(widthPx));
    } catch {
      // Keep the in-memory width when storage is unavailable.
    }
  }, [widthPx]);

  const onResizeStart = useCallback<PointerEventHandler<HTMLButtonElement>>(
    (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = widthPx;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        setWidthPx(clampPanelWidth(startWidth + startX - moveEvent.clientX));
      };
      const handlePointerUp = () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", handlePointerMove);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    },
    [widthPx],
  );

  const onResetWidth = useCallback(() => setWidthPx(DEFAULT_PANEL_WIDTH), []);

  return {
    canReset: widthPx !== DEFAULT_PANEL_WIDTH,
    onResetWidth,
    onResizeStart,
    widthPx,
  };
}

export function ConversationAuxiliaryPanel({
  children,
  className,
  onClose,
  sizing,
}: {
  children: ReactNode;
  className?: string;
  onClose: () => void;
  sizing: ConversationAuxiliaryPanelSizing;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 z-30 hidden bg-black/20 max-[900px]:block"
      />
      <aside
        className={cn(
          "border-border/70 bg-background relative z-40 flex min-h-0 shrink-0 flex-col border-l",
          "max-w-[calc(100%-300px)] max-[900px]:absolute max-[900px]:inset-y-0 max-[900px]:right-0 max-[900px]:!w-[calc(100%-24px)] max-[900px]:max-w-none max-[900px]:shadow-2xl",
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
          className="group/resize absolute inset-y-0 left-0 z-50 w-3 -translate-x-1/2 cursor-col-resize max-[900px]:hidden"
        >
          <span className="bg-border/0 group-hover/resize:bg-border/80 group-focus-visible/resize:bg-border/80 absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors" />
        </button>
        {children}
      </aside>
    </>
  );
}

export function ConversationAuxiliaryPanelHeader({
  actions,
  onClose,
  subtitle,
  title,
}: {
  actions?: ReactNode;
  onClose: () => void;
  subtitle?: ReactNode;
  title: ReactNode;
}) {
  return (
    <header className="border-border/60 flex h-14 shrink-0 cursor-default items-center gap-3 border-b px-4 py-2 select-none">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[13px] leading-4 font-semibold">
          {title}
        </h2>
        {subtitle ? (
          <p className="text-muted-foreground mt-0.5 truncate text-[11px] leading-4">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions}
      <Button
        type="button"
        aria-label="Close panel"
        title="Close panel"
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
      >
        <X size={15} />
      </Button>
    </header>
  );
}

export function ConversationAuxiliaryPanelBody({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto", className)}
      {...props}
    />
  );
}
