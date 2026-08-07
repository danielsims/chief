import { useId, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import type { ChatExecutionSelection } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import type { ComposerFormat } from "./composer-editing";
import type { ComposerImageAttachment } from "./composer-image-attachments";
import type { MentionCandidate } from "./composer-mention-popover";
import type { ComposerRichTextHandle } from "./composer-rich-text";
import type { EmojiOption } from "./emoji-catalog";
import { composerShortcutFormat } from "./composer-editing";
import { ComposerExecutionControls } from "./composer-execution-controls";
import {
  ComposerImageInput,
  ComposerImagePreviews,
} from "./composer-image-attachments";
import { ComposerMentionPopover } from "./composer-mention-popover";
import { ComposerRichText } from "./composer-rich-text";
import { ComposerSuggestions } from "./composer-suggestions";
import {
  ComposerEmojiAction,
  ComposerFormattingActions,
  ComposerFormattingToggle,
  ComposerImageAction,
  ComposerMentionAction,
  ComposerToolbarGroup,
  ComposerToolbarRoot,
} from "./composer-toolbar";
import { EmojiAutocomplete } from "./emoji-autocomplete";
import { emojiForShortcode, matchingEmoji } from "./emoji-catalog";

export type { MentionCandidate } from "./composer-mention-popover";

export function ChatComposer({
  value,
  onValueChange,
  onSubmit,
  execution,
  onExecutionChange,
  running = false,
  onInterrupt,
  showSuggestions = true,
  showExecutionControls = true,
  mentionCandidates = [],
  imageAttachments = [],
  onImageAttachmentsChange,
  placeholder = "Message Chief…",
  autoFocus = false,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  execution?: ChatExecutionSelection;
  onExecutionChange?: (execution: ChatExecutionSelection) => void;
  running?: boolean;
  onInterrupt?: () => void;
  showSuggestions?: boolean;
  showExecutionControls?: boolean;
  mentionCandidates?: MentionCandidate[];
  imageAttachments?: ComposerImageAttachment[];
  onImageAttachmentsChange?: (attachments: ComposerImageAttachment[]) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const editorRef = useRef<ComposerRichTextHandle>(null);
  const imageInputId = useId();
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dismissedMentionText, setDismissedMentionText] = useState<
    string | null
  >(null);
  const [emojiIndex, setEmojiIndex] = useState(0);
  const [formattingOpen, setFormattingOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [textBeforeCursor, setTextBeforeCursor] = useState("");
  const [activeFormats, setActiveFormats] = useState<ComposerFormat[]>([]);
  const mentionMatch = /(?:^|\s)@([^\s@]*)$/.exec(textBeforeCursor);
  const mentionQuery = mentionMatch?.[1]?.toLocaleLowerCase();
  const mentionDismissed = dismissedMentionText === textBeforeCursor;
  const visibleMentions =
    mentionQuery === undefined || mentionDismissed
      ? []
      : mentionCandidates
          .filter((candidate) =>
            `${candidate.name} ${candidate.role}`
              .toLocaleLowerCase()
              .includes(mentionQuery),
          )
          .sort((a, b) => Number(b.member) - Number(a.member))
          .slice(0, 6);
  const emojiMatch = /(?:^|\s):([a-z0-9_+-]*)$/iu.exec(textBeforeCursor);
  const emojiQuery = emojiMatch?.[1];
  const visibleEmojis =
    mentionQuery === undefined && emojiQuery !== undefined
      ? matchingEmoji(emojiQuery)
      : [];
  const preserveSelection = () => editorRef.current?.preserveSelection();
  const formatSelection = (format: ComposerFormat) =>
    editorRef.current?.format(format);
  const insertToolbarContent = (content: string) =>
    editorRef.current?.insertText(content);
  const openMentionPicker = () => {
    setDismissedMentionText(null);
    setEmojiOpen(false);
    setFormattingOpen(false);
    editorRef.current?.openMention();
  };
  const insertMention = (candidate: MentionCandidate) => {
    editorRef.current?.insertQueryResult("mention", `@${candidate.name}`);
    setMentionIndex(0);
    setDismissedMentionText(null);
  };
  const insertAutocompleteEmoji = (option: EmojiOption) => {
    editorRef.current?.insertQueryResult("emoji", option.emoji);
    setEmojiIndex(0);
  };
  const handleComposerKeyDown = (event: KeyboardEvent) => {
    if (visibleMentions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex(
          (current) =>
            (current +
              (event.key === "ArrowDown" ? 1 : -1) +
              visibleMentions.length) %
            visibleMentions.length,
        );
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const candidate =
          visibleMentions[mentionIndex % visibleMentions.length];
        if (candidate) insertMention(candidate);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDismissedMentionText(textBeforeCursor);
        return true;
      }
    }
    if (visibleEmojis.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setEmojiIndex(
          (current) =>
            (current +
              (event.key === "ArrowDown" ? 1 : -1) +
              visibleEmojis.length) %
            visibleEmojis.length,
        );
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const option = visibleEmojis[emojiIndex % visibleEmojis.length];
        if (option) insertAutocompleteEmoji(option);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        editorRef.current?.dismissQuery("emoji", emojiQuery ?? "");
        return true;
      }
    }
    if (event.metaKey || event.ctrlKey) {
      const format = composerShortcutFormat(event.key);
      if (format) {
        event.preventDefault();
        formatSelection(format);
        return true;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
      return true;
    }
    return false;
  };

  return (
    <div className={cn("space-y-2", className)}>
      {showSuggestions ? (
        <ComposerSuggestions
          onSelect={(suggestion) => {
            editorRef.current?.setMarkdown(suggestion);
          }}
        />
      ) : null}
      <div className="bg-card/80 relative rounded-xl border backdrop-blur-lg">
        <ComposerMentionPopover
          suggestions={visibleMentions}
          selectedIndex={mentionIndex}
          onDismiss={() => setDismissedMentionText(textBeforeCursor)}
          onSelect={insertMention}
        />
        <EmojiAutocomplete
          suggestions={visibleEmojis}
          selectedIndex={emojiIndex}
          onSelect={insertAutocompleteEmoji}
        />
        <ComposerImagePreviews
          attachments={imageAttachments}
          onRemove={(id) =>
            onImageAttachmentsChange?.(
              imageAttachments.filter((attachment) => attachment.id !== id),
            )
          }
        />
        <ComposerRichText
          ref={editorRef}
          autoFocus={autoFocus}
          value={value}
          placeholder={placeholder}
          onKeyDown={handleComposerKeyDown}
          onValueChange={onValueChange}
          onStateChange={(state) => {
            setTextBeforeCursor(state.textBeforeCursor);
            setActiveFormats((current) =>
              current.join(":") === state.activeFormats.join(":")
                ? current
                : state.activeFormats,
            );
            setMentionIndex(0);
            setEmojiIndex(0);
            const completedEmoji = /(?:^|\s):([a-z0-9_+-]+):$/iu.exec(
              state.textBeforeCursor,
            );
            const option = completedEmoji?.[1]
              ? emojiForShortcode(completedEmoji[1])
              : undefined;
            if (option) {
              window.requestAnimationFrame(() =>
                editorRef.current?.insertQueryResult(
                  "emoji-complete",
                  option.emoji,
                ),
              );
            }
          }}
        />
        <div className="flex min-w-0 items-center justify-between gap-2 px-2 pb-2">
          <div className="min-w-0 flex-1 overflow-x-auto">
            <ComposerToolbarRoot>
              <ComposerToolbarGroup>
                <AnimatePresence mode="popLayout" initial={false}>
                  {formattingOpen ? (
                    <motion.div
                      key="formatting-controls"
                      className="flex min-w-0 items-center gap-0.5"
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 28,
                      }}
                    >
                      <ComposerFormattingToggle
                        open
                        disabled={running}
                        onOpenChange={setFormattingOpen}
                        onPreserveSelection={preserveSelection}
                      />
                      <ComposerFormattingActions
                        activeFormats={activeFormats}
                        disabled={running}
                        onFormat={formatSelection}
                        onPreserveSelection={preserveSelection}
                      />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="composer-actions"
                      className="flex items-center gap-0.5"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 28,
                      }}
                    >
                      {mentionCandidates.length > 0 ? (
                        <ComposerMentionAction
                          disabled={running}
                          onMention={openMentionPicker}
                          onPreserveSelection={preserveSelection}
                        />
                      ) : null}
                      {onImageAttachmentsChange ? (
                        <>
                          <ComposerImageAction
                            disabled={running}
                            inputId={imageInputId}
                            onPreserveSelection={preserveSelection}
                          />
                          <ComposerImageInput
                            attachments={imageAttachments}
                            disabled={running}
                            inputId={imageInputId}
                            onAttachmentsChange={onImageAttachmentsChange}
                          />
                        </>
                      ) : null}
                      <ComposerEmojiAction
                        open={emojiOpen}
                        disabled={running}
                        onOpenChange={(open) => {
                          setEmojiOpen(open);
                          if (open) {
                            setDismissedMentionText(textBeforeCursor);
                            setFormattingOpen(false);
                          }
                        }}
                        onEmojiSelect={(emoji) =>
                          insertToolbarContent(`${emoji} `)
                        }
                        onPreserveSelection={preserveSelection}
                      />
                      <ComposerFormattingToggle
                        open={false}
                        disabled={running}
                        onOpenChange={(open) => {
                          setFormattingOpen(open);
                          if (open) {
                            setDismissedMentionText(textBeforeCursor);
                            setEmojiOpen(false);
                          }
                        }}
                        onPreserveSelection={preserveSelection}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </ComposerToolbarGroup>
              {showExecutionControls ? (
                <ComposerExecutionControls
                  execution={execution}
                  disabled={running}
                  onExecutionChange={onExecutionChange}
                />
              ) : null}
            </ComposerToolbarRoot>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {value.trim() ? (
              <Button
                size="icon-xs"
                aria-label="Send message"
                onClick={onSubmit}
              >
                <ArrowUp size={14} />
              </Button>
            ) : running && onInterrupt ? (
              <Button
                size="icon-sm"
                variant="secondary"
                aria-label="Stop response"
                onClick={onInterrupt}
                className="rounded-full shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent),0_1px_2px_rgba(0,0,0,0.08)]"
              >
                <Square size={10} fill="currentColor" />
              </Button>
            ) : (
              <Button
                size="icon-xs"
                aria-label="Send message"
                onClick={onSubmit}
              >
                <ArrowUp size={14} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
