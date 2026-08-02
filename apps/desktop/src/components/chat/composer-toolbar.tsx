import type { MouseEvent, ReactNode } from "react";
import {
  ALargeSmall,
  AtSign,
  Bold,
  Code,
  Italic,
  Link,
  List,
  ListOrdered,
  Paperclip,
  Quote,
  SmilePlus,
  Strikethrough,
  X,
} from "lucide-react";

import { Button, buttonVariants } from "@chief/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@chief/ui/components/tooltip";
import { cn } from "@chief/ui/lib/utils";

import type { ComposerFormat } from "./composer-editing";
import { ComposerEmojiPicker } from "./composer-emoji-picker";

export function ComposerToolbarRoot({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-8 min-w-0 items-center gap-1">{children}</div>
  );
}

export function ComposerToolbarGroup({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 items-center gap-0.5">{children}</div>;
}

function ComposerActionTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip delayDuration={350} disableHoverableContent>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={9}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function preserveSelection(
  event: MouseEvent<HTMLButtonElement>,
  onPreserveSelection: () => void,
) {
  onPreserveSelection();
  event.preventDefault();
}

function ComposerActionButton({
  label,
  pressed,
  disabled,
  onClick,
  onPreserveSelection,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  onPreserveSelection: () => void;
  children: ReactNode;
}) {
  return (
    <ComposerActionTooltip label={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onMouseDown={(event) => preserveSelection(event, onPreserveSelection)}
        onClick={onClick}
        className={cn(
          "text-muted-foreground hover:text-foreground rounded-md",
          pressed && "bg-accent text-foreground",
        )}
      >
        {children}
      </Button>
    </ComposerActionTooltip>
  );
}

export function ComposerFormattingToggle({
  open,
  disabled,
  onOpenChange,
  onPreserveSelection,
}: {
  open: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onPreserveSelection: () => void;
}) {
  return (
    <ComposerActionButton
      label={open ? "Hide formatting" : "Formatting"}
      pressed={open}
      disabled={disabled}
      onClick={() => onOpenChange(!open)}
      onPreserveSelection={onPreserveSelection}
    >
      {open ? <X size={17} /> : <ALargeSmall size={18} />}
    </ComposerActionButton>
  );
}

export function ComposerMentionAction({
  disabled,
  onMention,
  onPreserveSelection,
}: {
  disabled?: boolean;
  onMention: () => void;
  onPreserveSelection: () => void;
}) {
  return (
    <ComposerActionButton
      label="Mention someone"
      disabled={disabled}
      onClick={onMention}
      onPreserveSelection={onPreserveSelection}
    >
      <AtSign size={18} />
    </ComposerActionButton>
  );
}

export function ComposerImageAction({
  disabled,
  inputId,
  onPreserveSelection,
}: {
  disabled?: boolean;
  inputId: string;
  onPreserveSelection: () => void;
}) {
  return (
    <ComposerActionTooltip label="Attach image">
      <label
        htmlFor={inputId}
        aria-label="Attach image"
        aria-disabled={disabled}
        onMouseDown={(event) => {
          onPreserveSelection();
          event.preventDefault();
        }}
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon-sm" }),
          "text-muted-foreground hover:text-foreground rounded-md",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <Paperclip size={18} />
      </label>
    </ComposerActionTooltip>
  );
}

function FormatAction({
  format,
  label,
  shortcut,
  pressed,
  disabled,
  onFormat,
  onPreserveSelection,
  children,
}: {
  format: ComposerFormat;
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  onFormat: (format: ComposerFormat) => void;
  onPreserveSelection: () => void;
  children: ReactNode;
}) {
  return (
    <ComposerActionButton
      label={shortcut ? `${label} · ${shortcut}` : label}
      pressed={pressed}
      disabled={disabled}
      onClick={() => onFormat(format)}
      onPreserveSelection={onPreserveSelection}
    >
      {children}
    </ComposerActionButton>
  );
}

export function ComposerFormattingActions({
  activeFormats,
  disabled,
  onFormat,
  onPreserveSelection,
}: {
  activeFormats: readonly ComposerFormat[];
  disabled?: boolean;
  onFormat: (format: ComposerFormat) => void;
  onPreserveSelection: () => void;
}) {
  return (
    <ComposerToolbarGroup>
      <span className="bg-border/70 mx-1 h-4 w-px" />
      <FormatAction
        format="bold"
        label="Bold"
        shortcut="⌘B"
        pressed={activeFormats.includes("bold")}
        disabled={disabled}
        onFormat={onFormat}
        onPreserveSelection={onPreserveSelection}
      >
        <Bold size={15} />
      </FormatAction>
      <FormatAction
        format="italic"
        label="Italic"
        shortcut="⌘I"
        pressed={activeFormats.includes("italic")}
        disabled={disabled}
        onFormat={onFormat}
        onPreserveSelection={onPreserveSelection}
      >
        <Italic size={15} />
      </FormatAction>
      <FormatAction
        format="strike"
        label="Strikethrough"
        pressed={activeFormats.includes("strike")}
        disabled={disabled}
        onFormat={onFormat}
        onPreserveSelection={onPreserveSelection}
      >
        <Strikethrough size={15} />
      </FormatAction>
      <FormatAction
        format="link"
        label="Link"
        shortcut="⌘K"
        pressed={activeFormats.includes("link")}
        disabled={disabled}
        onFormat={onFormat}
        onPreserveSelection={onPreserveSelection}
      >
        <Link size={15} />
      </FormatAction>
      <FormatAction
        format="code"
        label="Code"
        pressed={activeFormats.includes("code")}
        disabled={disabled}
        onFormat={onFormat}
        onPreserveSelection={onPreserveSelection}
      >
        <Code size={15} />
      </FormatAction>
      <FormatAction
        format="bullet-list"
        label="Bulleted list"
        pressed={activeFormats.includes("bullet-list")}
        disabled={disabled}
        onFormat={onFormat}
        onPreserveSelection={onPreserveSelection}
      >
        <List size={15} />
      </FormatAction>
      <FormatAction
        format="ordered-list"
        label="Numbered list"
        pressed={activeFormats.includes("ordered-list")}
        disabled={disabled}
        onFormat={onFormat}
        onPreserveSelection={onPreserveSelection}
      >
        <ListOrdered size={15} />
      </FormatAction>
      <FormatAction
        format="quote"
        label="Quote"
        pressed={activeFormats.includes("quote")}
        disabled={disabled}
        onFormat={onFormat}
        onPreserveSelection={onPreserveSelection}
      >
        <Quote size={15} />
      </FormatAction>
    </ComposerToolbarGroup>
  );
}

export function ComposerEmojiAction({
  open,
  disabled,
  onEmojiSelect,
  onOpenChange,
  onPreserveSelection,
}: {
  open: boolean;
  disabled?: boolean;
  onEmojiSelect: (emoji: string) => void;
  onOpenChange: (open: boolean) => void;
  onPreserveSelection: () => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <ComposerActionTooltip label="Insert emoji">
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Insert emoji"
            disabled={disabled}
            onMouseDown={(event) =>
              preserveSelection(event, onPreserveSelection)
            }
            className="text-muted-foreground hover:text-foreground rounded-md"
          >
            <SmilePlus size={18} />
          </Button>
        </PopoverTrigger>
      </ComposerActionTooltip>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={10}
        className="ring-foreground/10 w-auto overflow-hidden rounded-2xl border-0 bg-transparent p-0 shadow-[0_18px_48px_-16px_color-mix(in_srgb,var(--foreground)_28%,transparent)] ring-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <ComposerEmojiPicker
          onSelect={(emoji) => {
            onEmojiSelect(emoji);
            onOpenChange(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
