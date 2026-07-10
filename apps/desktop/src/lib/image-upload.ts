import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { api } from "@marketer/backend/convex/_generated/api";
import type { Id } from "@marketer/backend/convex/_generated/dataModel";
import { convex } from "./convex";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be read."));
    };
    image.src = url;
  });
}

/**
 * Normalize uploads before sending them to Convex file storage. WebP keeps
 * alpha while capping storage and transfer size.
 */
async function imageFileToBlob(
  file: File,
  maximumDimension = 512,
): Promise<Blob> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file.");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("Choose an image smaller than 10 MB.");
  }

  const image = await loadImage(file);
  const scale = Math.min(
    1,
    maximumDimension / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processing is unavailable.");
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("That image could not be processed.")),
      "image/webp",
      0.9,
    );
  });
}

export type ImageAssetKind = "profile" | "workspace";

export async function uploadImageAsset(
  file: File,
  kind: ImageAssetKind,
): Promise<string> {
  const blob = await imageFileToBlob(file);
  const uploadUrl = await convex.mutation(
    api.imageAssets.generateUploadUrl,
    {},
  );
  const fetcher = isTauri() ? tauriFetch : fetch;
  const response = await fetcher(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": blob.type },
    body: blob,
  });
  if (!response.ok) throw new Error("Image upload failed.");
  const { storageId } = (await response.json()) as { storageId: string };
  const result = await convex.mutation(api.imageAssets.save, {
    kind,
    storageId: storageId as Id<"_storage">,
  });
  return result.url;
}

export async function removeImageAsset(kind: ImageAssetKind) {
  await convex.mutation(api.imageAssets.remove, { kind });
}
