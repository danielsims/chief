import {
  attachmentUploadPayloadSchema,
  attachmentUploadResultSchema,
} from "@chief/relay-contracts";

import { HttpError, json, parseJson, relayError } from "./http";

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/**
 * Stores an attachment body in the ARTIFACTS R2 bucket under an opaque,
 * conversation-scoped key. Reads stay behind relay authentication and channel
 * authorization; the object key is not a bearer credential.
 */
export async function uploadAttachment(
  env: Env,
  request: Request,
  publicOrigin: string,
  workspaceId: string,
  conversationId: string,
) {
  const payload = attachmentUploadPayloadSchema.parse(await parseJson(request));
  const contentType = normalizedImageType(payload.contentType);
  if (!contentType) {
    throw new HttpError(
      415,
      "unsupported_content_type",
      "Only image attachments are supported for now.",
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Bytes(payload.base64);
  } catch {
    throw new HttpError(
      400,
      "invalid_base64",
      "The attachment data is not valid base64.",
    );
  }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new HttpError(
      413,
      "attachment_too_large",
      "Attachments must be 8MB or smaller.",
    );
  }
  if (!matchesImageSignature(bytes, contentType)) {
    throw new HttpError(
      415,
      "attachment_content_mismatch",
      "The attachment bytes do not match the declared image type.",
    );
  }
  const ext = mimeExt(contentType);
  const objectName = `${crypto.randomUUID()}.${ext}`;
  const key = `${workspaceId}/${conversationId}/${objectName}`;
  await env.ARTIFACTS.put(key, bytes, {
    customMetadata: { contentType, workspaceId, conversationId },
    httpMetadata: { contentType },
  });
  return json(
    attachmentUploadResultSchema.parse({
      url: `${publicOrigin}/v1/workspaces/${workspaceId}/conversations/${conversationId}/attachments/${objectName}`,
      key,
    }),
    { status: 201 },
  );
}

/** Authenticated read after the router has enforced conversation access. */
export async function getAttachment(env: Env, key: string) {
  const object = await env.ARTIFACTS.get(key);
  if (!object) {
    return relayError(
      404,
      "attachment_not_found",
      "The attachment was not found.",
    );
  }
  const contentType =
    object.httpMetadata?.contentType ??
    object.customMetadata?.contentType ??
    "application/octet-stream";
  return new Response(object.body, {
    headers: {
      "content-type": contentType,
      "cache-control": "private, max-age=300",
      "content-security-policy": "sandbox; default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function uploadImageAsset(
  env: Env,
  request: Request,
  publicOrigin: string,
  key: string,
  publicPath: string,
) {
  const payload = attachmentUploadPayloadSchema.parse(await parseJson(request));
  const contentType = normalizedImageType(payload.contentType);
  if (!contentType) {
    throw new HttpError(
      415,
      "unsupported_content_type",
      "Choose a PNG, JPEG, WebP, or GIF image.",
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Bytes(payload.base64);
  } catch {
    throw new HttpError(400, "invalid_base64", "The image data is invalid.");
  }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new HttpError(
      413,
      "image_too_large",
      "Images must be 8MB or smaller.",
    );
  }
  if (!matchesImageSignature(bytes, contentType)) {
    throw new HttpError(
      415,
      "image_content_mismatch",
      "The image content does not match its file type.",
    );
  }
  await env.ARTIFACTS.put(key, bytes, {
    customMetadata: { contentType },
    httpMetadata: { contentType },
  });
  const version = Date.now().toString(36);
  return json(
    attachmentUploadResultSchema.parse({
      key,
      url: `${publicOrigin}${publicPath}?v=${version}`,
    }),
    { status: 201 },
  );
}

export async function deleteImageAsset(env: Env, key: string) {
  await env.ARTIFACTS.delete(key);
  return json({ deleted: true });
}

export async function getPublicImageAsset(env: Env, key: string) {
  const object = await env.ARTIFACTS.get(key);
  if (!object) {
    return relayError(404, "image_not_found", "The image was not found.");
  }
  const contentType =
    object.httpMetadata?.contentType ??
    object.customMetadata?.contentType ??
    "application/octet-stream";
  return new Response(object.body, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=31536000, immutable",
      "content-security-policy": "sandbox; default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

function decodeBase64Bytes(encoded: string): Uint8Array {
  const binary = atob(encoded.replace(/\s+/gu, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function normalizedImageType(contentType: string): string | undefined {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return normalized &&
    ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(normalized)
    ? normalized
    : undefined;
}

function mimeExt(contentType: string): string {
  if (contentType === "image/jpeg") return "jpg";
  return contentType.slice("image/".length);
}

function matchesImageSignature(bytes: Uint8Array, contentType: string) {
  const starts = (...signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  if (contentType === "image/png")
    return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (contentType === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (contentType === "image/gif") {
    return (
      starts(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) ||
      starts(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)
    );
  }
  if (contentType === "image/webp") {
    return (
      starts(0x52, 0x49, 0x46, 0x46) &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return false;
}
