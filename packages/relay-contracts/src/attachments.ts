import { z } from "zod";

export const attachmentUploadPayloadSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().trim().min(1).max(128),
    base64: z.string().trim().min(1),
  })
  .strict();

export const attachmentUploadResultSchema = z
  .object({
    url: z.url(),
    key: z.string().trim().min(1).max(512),
  })
  .strict();

export const imageAssetDeleteResultSchema = z
  .object({ deleted: z.boolean() })
  .strict();

export type AttachmentUploadPayload = z.infer<
  typeof attachmentUploadPayloadSchema
>;
export type AttachmentUploadResult = z.infer<
  typeof attachmentUploadResultSchema
>;

/** The image types a message can carry, as the relay stores them. */
export const messageImageTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

/**
 * An image attached to a message: uploaded once to the conversation's relay
 * storage, then referenced by URL, as a Blossom blob is from a Nostr event.
 */
export const messageAttachmentPayloadSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    /** As the sender declared it; the stored type follows the URL's extension. */
    mediaType: z.string().trim().min(1).max(128),
    url: z.url(),
    /** A small base64 JPEG preview, as the iPhone app sends. */
    thumbnail: z.string().max(200_000).optional(),
  })
  .strict();

export type MessageAttachmentPayload = z.infer<
  typeof messageAttachmentPayloadSchema
>;

/** An attachment as an agent receives it, with a link it can fetch. */
export const agentAttachmentSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    mediaType: z.enum(messageImageTypes),
    url: z.url(),
  })
  .strict();

export type AgentAttachment = z.infer<typeof agentAttachmentSchema>;

const attachmentPathPattern =
  /^\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/attachments\/([0-9a-f-]{36}\.(?:png|jpg|webp|gif))$/u;

/**
 * Where an attachment URL points in relay storage, or undefined when it
 * isn't a relay attachment. The origin is ignored: clients read the path
 * from their own relay.
 */
export function attachmentLocation(url: string) {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const match = attachmentPathPattern.exec(path);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const extension = match[3].slice(match[3].lastIndexOf(".") + 1);
  return {
    workspaceId: decodeURIComponent(match[1]),
    conversationId: decodeURIComponent(match[2]),
    objectName: match[3],
    mediaType: extension === "jpg" ? "image/jpeg" : `image/${extension}`,
    path,
  };
}

/** The images attached to a message, from its components. */
export function messageAttachments(
  components: readonly { kind: string; payload: unknown }[],
) {
  return components.flatMap((component) => {
    if (component.kind !== "attachment") return [];
    const parsed = messageAttachmentPayloadSchema.safeParse(component.payload);
    return parsed.success ? [parsed.data] : [];
  });
}
