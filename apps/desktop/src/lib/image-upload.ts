import type { RelayClient } from "@chief/relay-client";

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
  client: RelayClient,
): Promise<string> {
  const blob = await imageFileToBlob(file);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const payload = {
    fileName: file.name || `${kind}.webp`,
    contentType: blob.type,
    base64: btoa(binary),
  };
  const result =
    kind === "profile"
      ? await client.uploadProfileImage(payload)
      : await client.uploadWorkspaceImage(payload);
  return result.url;
}

export async function removeImageAsset(
  kind: ImageAssetKind,
  client: RelayClient,
) {
  if (kind === "profile") await client.deleteProfileImage();
  else await client.deleteWorkspaceImage();
}
