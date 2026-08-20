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

export type AttachmentUploadPayload = z.infer<
  typeof attachmentUploadPayloadSchema
>;
export type AttachmentUploadResult = z.infer<
  typeof attachmentUploadResultSchema
>;
