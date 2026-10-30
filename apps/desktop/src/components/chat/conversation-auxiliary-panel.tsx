import type { ComponentProps, ReactNode, Ref } from "react";
import { ChevronLeft, X } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import type { ResizableSidePanelSizing } from "../resizable-side-panel";
import {
  ResizableSidePanel,
  useResizableSidePanelSizing,
} from "../resizable-side-panel";

const PANEL_WIDTH_STORAGE_KEY = "chief.conversations.auxiliary-panel-width";

export type ConversationAuxiliaryPanelSizing = ResizableSidePanelSizing;

export function useConversationAuxiliaryPanelSizing(): ConversationAuxiliaryPanelSizing {
  return useResizableSidePanelSizing({
    storageKey: PANEL_WIDTH_STORAGE_KEY,
  });
}

export function ConversationAuxiliaryPanel({
  children,
  className,
  fill = false,
  onClose,
  sizing,
}: {
  children: ReactNode;
  className?: string;
  /** Takes the remaining width as the main card, e.g. an open session. */
  fill?: boolean;
  onClose: () => void;
  sizing: ConversationAuxiliaryPanelSizing;
}) {
  return (
    <ResizableSidePanel
      className={className}
      fill={fill}
      onClose={onClose}
      sizing={sizing}
    >
      {children}
    </ResizableSidePanel>
  );
}

export function ConversationAuxiliaryPanelHeader({
  actions,
  backLabel = "Back",
  onBack,
  onClose,
  subtitle,
  title,
}: {
  actions?: ReactNode;
  backLabel?: string;
  onBack?: () => void;
  onClose: () => void;
  subtitle?: ReactNode;
  title: ReactNode;
}) {
  return (
    <header className="border-border/60 flex h-14 shrink-0 cursor-default items-center gap-3 border-b px-4 py-2 select-none">
      {onBack ? (
        <Button
          type="button"
          aria-label={backLabel}
          title={backLabel}
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          className="-ml-1"
        >
          <ChevronLeft size={16} />
        </Button>
      ) : null}
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

export function ConversationAuxiliaryBreadcrumb({
  current,
  items,
}: {
  current: ReactNode;
  items: readonly { key: string; label: ReactNode; onClick: () => void }[];
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {items.map((item, index) => (
        <span key={item.key} className="contents">
          {index > 0 ? (
            <span className="text-muted-foreground/60">/</span>
          ) : null}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground min-w-0 truncate font-normal transition-colors"
            onClick={item.onClick}
          >
            {item.label}
          </button>
        </span>
      ))}
      {items.length > 0 ? (
        <span className="text-muted-foreground/60">/</span>
      ) : null}
      <strong className="min-w-0 truncate font-semibold">{current}</strong>
    </span>
  );
}

export function ConversationAuxiliaryPanelBody({
  className,
  ref,
  ...props
}: ComponentProps<"div"> & { ref?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      className={cn("min-h-0 flex-1 overflow-y-auto", className)}
      {...props}
    />
  );
}
