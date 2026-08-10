import { useState } from "react";
import { MessageCircle } from "lucide-react";

import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { Input } from "@chief/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";

import type { UserStatus } from "../lib/user-status";
import { ComposerEmojiPicker } from "./chat/composer-emoji-picker";

const STATUS_PRESETS = [
  { text: "In a meeting", emoji: "🗣️" },
  { text: "Commuting", emoji: "🚌" },
  { text: "Out sick", emoji: "🤒" },
  { text: "Vacationing", emoji: "🏖️" },
  { text: "Working remotely", emoji: "🏠" },
] as const;

export function SetStatusDialog({
  onClear,
  onOpenChange,
  onSave,
  open,
  status,
}: {
  onClear: () => void;
  onOpenChange: (open: boolean) => void;
  onSave: (status: UserStatus) => void;
  open: boolean;
  status: UserStatus | null;
}) {
  const [text, setText] = useState(status?.text ?? "");
  const [emoji, setEmoji] = useState(status?.emoji ?? "");
  const [emojiOpen, setEmojiOpen] = useState(false);

  const save = () => {
    if (!text.trim() && !emoji) return;
    onSave({ text: text.trim(), emoji });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-base">Set a status</DialogTitle>
          <DialogDescription>
            Let people in this workspace know what you’re up to.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5 flex items-center gap-2">
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Choose status emoji"
                className="border-input hover:bg-accent flex size-9 shrink-0 items-center justify-center rounded-lg border text-lg transition-colors"
              >
                {emoji || <MessageCircle size={16} />}
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="start"
              className="w-auto overflow-hidden rounded-2xl p-0"
            >
              <ComposerEmojiPicker
                onSelect={(nextEmoji) => {
                  setEmoji(nextEmoji);
                  setEmojiOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          <Input
            autoFocus
            value={text}
            placeholder="What’s your status?"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                save();
              }
            }}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {STATUS_PRESETS.map((preset) => (
            <button
              key={preset.text}
              type="button"
              onClick={() => {
                setText(preset.text);
                setEmoji(preset.emoji);
              }}
              className="border-input text-muted-foreground hover:bg-accent hover:text-foreground rounded-full border px-2.5 py-1 text-xs transition-colors"
            >
              {preset.emoji} {preset.text}
            </button>
          ))}
        </div>
        <DialogFooter className="mt-6 items-center justify-between">
          <div>
            {status ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onClear();
                  onOpenChange(false);
                }}
              >
                Clear status
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!text.trim() && !emoji}
              onClick={save}
            >
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
