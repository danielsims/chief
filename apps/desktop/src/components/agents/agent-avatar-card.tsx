import { useContext, useRef, useState } from "react";
import { toast } from "sonner";

import type { RelayClient } from "@chief/relay-client";
import type { AgentAvatar as AgentAvatarValue } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";

import { AgentAppearanceContext, AgentAvatar } from "../agent-avatar";
import { SectionHeading, SettingGroup } from "./agent-detail-sections";

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

export function AgentAvatarCard({
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
  const disabled = !ready || !relayClient || busy;

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

  return (
    <section>
      <SectionHeading
        title="Avatar"
        description="How this agent appears in conversations."
      />
      <SettingGroup>
        <div className="flex flex-wrap items-center gap-4 px-4 py-3">
          <AgentAvatar
            agentId={agentId}
            label={agentName}
            className="size-12"
          />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => imageInput.current?.click()}
            >
              Upload image
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => spriteInput.current?.click()}
            >
              Upload sprite sheet
            </Button>
            {current ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => void save(null, () => null)}
              >
                Remove
              </Button>
            ) : null}
          </div>
          <input
            ref={imageInput}
            type="file"
            accept={IMAGE_TYPES}
            className="sr-only"
            disabled={disabled}
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
            disabled={disabled}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) setSprite({ file, grid: PET_PACK_GRID });
            }}
          />
        </div>
        {sprite ? (
          <div className="flex flex-wrap items-end gap-3 px-4 py-3">
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
                  className="h-8 w-20"
                />
              </label>
            ))}
            <div className="ml-auto flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setSprite(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={disabled}
                onClick={() =>
                  void save(sprite.file, (url) => ({
                    kind: "sprite",
                    url,
                    ...sprite.grid,
                    frames: Math.min(
                      sprite.grid.frames,
                      sprite.grid.columns * sprite.grid.rows,
                    ),
                    fps: Math.min(sprite.grid.fps, 30),
                  }))
                }
              >
                Save sprite
              </Button>
            </div>
          </div>
        ) : null}
      </SettingGroup>
    </section>
  );
}
