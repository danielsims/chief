import { X } from "lucide-react";
import { toast } from "sonner";

import type { MessageAttachment } from "@chief/agent-runtime/types";
import { isJsonString } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_ATTACHMENTS = 4;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface ComposerImageAttachment extends MessageAttachment {
  id: string;
}

export function imageAttachmentError(file: Pick<File, "size" | "type">) {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    return "Choose a PNG, JPEG, WebP, or GIF image.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Images must be smaller than 8 MB.";
  }
  return undefined;
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.onload = () =>
      isJsonString(reader.result)
        ? resolve(reader.result)
        : reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
}

async function attachmentFromFile(
  file: File,
): Promise<ComposerImageAttachment> {
  const error = imageAttachmentError(file);
  if (error) throw new Error(error);
  return {
    id: crypto.randomUUID(),
    name: file.name || "Image",
    mediaType: file.type,
    url: await readDataUrl(file),
  };
}

export function ComposerImageInput({
  attachments,
  disabled,
  inputId,
  onAttachmentsChange,
}: {
  attachments: readonly ComposerImageAttachment[];
  disabled?: boolean;
  inputId: string;
  onAttachmentsChange: (attachments: ComposerImageAttachment[]) => void;
}) {
  return (
    <input
      id={inputId}
      className="sr-only"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      multiple
      disabled={disabled}
      onChange={async (event) => {
        const input = event.currentTarget;
        const files = Array.from(input.files ?? []).slice(
          0,
          Math.max(0, MAX_IMAGE_ATTACHMENTS - attachments.length),
        );
        input.value = "";
        if (files.length === 0) return;
        try {
          const additions = await Promise.all(files.map(attachmentFromFile));
          onAttachmentsChange([...attachments, ...additions]);
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : "The image could not be attached.",
          );
        }
      }}
    />
  );
}

export function ComposerImagePreviews({
  attachments,
  onRemove,
}: {
  attachments: readonly ComposerImageAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-3 pt-3">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="bg-muted/70 group/attachment relative size-16 overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent)]"
        >
          <img
            src={attachment.url}
            alt={attachment.name}
            className="size-full object-cover"
          />
          <Button
            type="button"
            variant="secondary"
            size="icon-xs"
            aria-label={`Remove ${attachment.name}`}
            onClick={() => onRemove(attachment.id)}
            className="absolute top-1 right-1 size-6 rounded-full opacity-0 shadow-md transition-opacity group-hover/attachment:opacity-100 focus-visible:opacity-100"
          >
            <X size={13} />
          </Button>
        </div>
      ))}
    </div>
  );
}
