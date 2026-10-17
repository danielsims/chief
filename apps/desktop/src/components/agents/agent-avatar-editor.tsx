import { useContext, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import type { RelayClient } from "@chief/relay-client";
import type { AgentAvatar as AgentAvatarValue } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@chief/ui/components/dropdown-menu";
import { Input } from "@chief/ui/components/input";

import { AgentAppearanceContext, AgentAvatar } from "../agent-avatar";

const IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif";

/** The common pet-pack grid: eight frames across, idle on the first row. */
const PET_PACK_GRID = { columns: 8, rows: 9, frames: 8, fps: 8 };

type SpriteGrid = typeof PET_PACK_GRID;

function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.onload = () => {
      const result = reader.result;
      if (result === null || result instanceof ArrayBuffer) {
        reject(new Error("The image could not be read."));
      } else {
        resolve(result.slice(result.indexOf(",") + 1));
      }
    };
    reader.readAsDataURL(file);
  });
}

/**
 * The agent's avatar at the top of its page, which is also where it is
 * changed: an image, an animated sprite sheet, or back to the default.
 */
export function AgentAvatarEditor({
  agentId,
  agentName,
  relayClient,
  ready,
  onChanged,
}: {
  agentId: string;
  agentName: string;
  relayClient: RelayClient | null | undefined;
  ready: boolean;
  onChanged?: () => Promise<void>;
}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const spriteInput = useRef<HTMLInputElement>(null);
  const current = useContext(AgentAppearanceContext).avatars.get(agentId);
  const [busy, setBusy] = useState(false);
  const [sprite, setSprite] = useState<{ file: File; grid: SpriteGrid } | null>(
    null,
  );
  const editable = ready && Boolean(relayClient);

  const save = async (
    file: File | null,
    avatar: (url: string) => AgentAvatarValue | null,
  ) => {
    if (!relayClient) return;
    setBusy(true);
    try {
      const url = file
        ? (
            await relayClient.uploadAgentAvatarImage(agentId, {
              fileName: file.name || "avatar",
              contentType: file.type,
              base64: await fileBase64(file),
            })
          ).url
        : "";
      await relayClient.setAgentAvatar(agentId, avatar(url));
      setSprite(null);
      await onChanged?.();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The avatar could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  const setGrid = (key: keyof SpriteGrid, value: string) =>
    setSprite((pending) =>
      pending
        ? {
            ...pending,
            grid: { ...pending.grid, [key]: Math.max(1, Number(value) || 1) },
          }
        : pending,
    );

  const avatar = (
    <AgentAvatar agentId={agentId} label={agentName} className="size-full" />
  );
  if (!editable) {
    return <span className="relative flex size-14 shrink-0">{avatar}</span>;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={busy}
            aria-label={`Change ${agentName}'s avatar`}
            className="group focus-visible:ring-ring relative flex size-14 shrink-0 rounded-[28%] focus-visible:ring-2 focus-visible:outline-none"
          >
            {avatar}
            <span className="absolute inset-0 rounded-[28%] bg-black/0 transition-colors group-hover:bg-black/25" />
            <span className="bg-background text-foreground absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full shadow-[0_0_0_1px_color-mix(in_srgb,var(--foreground)_12%,transparent)]">
              <Pencil size={10} />
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => imageInput.current?.click()}>
            Upload image
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => spriteInput.current?.click()}>
            Upload animated sprite
          </DropdownMenuItem>
          {current ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void save(null, () => null)}>
                Remove avatar
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={imageInput}
        type="file"
        accept={IMAGE_TYPES}
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void save(file, (url) => ({ kind: "image", url }));
        }}
      />
      <input
        ref={spriteInput}
        type="file"
        accept={IMAGE_TYPES}
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) setSprite({ file, grid: PET_PACK_GRID });
        }}
      />
      <Dialog
        open={sprite !== null}
        onOpenChange={(open) => {
          if (!open) setSprite(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Animated sprite</DialogTitle>
            <DialogDescription>
              The first frames, read row by row, loop as {agentName}'s avatar.
            </DialogDescription>
          </DialogHeader>
          {sprite ? (
            <div className="grid grid-cols-4 gap-3">
              {(
                [
                  ["columns", "Columns"],
                  ["rows", "Rows"],
                  ["frames", "Frames"],
                  ["fps", "FPS"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="grid gap-1 text-[12px] font-medium">
                  {label}
                  <Input
                    type="number"
                    min={1}
                    value={sprite.grid[key]}
                    onChange={(event) => setGrid(key, event.target.value)}
                    className="h-8"
                  />
                </label>
              ))}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSprite(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy || !sprite}
              onClick={() => {
                if (!sprite) return;
                const { file, grid } = sprite;
                void save(file, (url) => ({
                  kind: "sprite",
                  url,
                  ...grid,
                  frames: Math.min(grid.frames, grid.columns * grid.rows),
                  fps: Math.min(grid.fps, 30),
                }));
              }}
            >
              Use sprite
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
