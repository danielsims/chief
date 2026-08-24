import { z } from "zod";

import {
  agentIdSchema,
  conversationIdSchema,
  isoDateTimeSchema,
} from "./identifiers";

export const workspaceFileSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    path: z.string().trim().min(1).max(512),
    title: z.string().trim().min(1).max(240),
    mimeType: z.string().trim().min(1).max(128),
    content: z.string().max(200_000),
    conversationId: conversationIdSchema,
    authorAgentId: agentIdSchema,
    version: z.int().positive(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const brandProfileSchema = z
  .object({
    markdown: z.string().trim().min(1).max(100_000),
    sourceUrls: z.array(z.url()).max(50),
    version: z.int().positive(),
    authorAgentId: agentIdSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const brandProfileSaveSchema = z
  .object({
    markdown: z.string().trim().min(1).max(100_000),
    sourceUrls: z.array(z.url()).max(50),
    conversationId: conversationIdSchema,
  })
  .strict();

export const brandProfileResultSchema = z
  .object({
    profile: brandProfileSchema,
    file: workspaceFileSchema,
  })
  .strict();

export const prospectRelevanceSchema = z.enum(["high", "medium", "low"]);
export const prospectStatusSchema = z.enum([
  "new",
  "reviewing",
  "contacted",
  "dismissed",
]);

export const prospectSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(240),
    company: z.string().trim().max(240).nullable(),
    source: z.string().trim().min(1).max(240),
    sourceUrl: z.url(),
    summary: z.string().trim().min(1).max(10_000),
    evidence: z.string().trim().min(1).max(10_000),
    outreachAngle: z.string().trim().min(1).max(10_000),
    relevance: prospectRelevanceSchema,
    status: prospectStatusSchema,
    authorAgentId: agentIdSchema,
    foundAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const prospectSaveSchema = prospectSchema
  .omit({ authorAgentId: true, foundAt: true, updatedAt: true })
  .extend({ company: z.string().trim().max(240).nullable().default(null) })
  .strict();

export const prospectsResultSchema = z
  .object({ prospects: z.array(prospectSchema) })
  .strict();

export const workspaceFilesResultSchema = z
  .object({ files: z.array(workspaceFileSchema) })
  .strict();

export const workspaceFileUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    content: z.string().max(200_000),
    expectedVersion: z.int().positive(),
  })
  .strict();

const workspaceFilePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      path
        .split("/")
        .every((segment) => segment && segment !== "." && segment !== ".."),
    "Workspace file paths must be relative and cannot traverse directories.",
  );

export const workspaceFileSaveSchema = z
  .object({
    id: z.string().trim().min(1).max(160).optional(),
    path: workspaceFilePathSchema,
    title: z.string().trim().min(1).max(240),
    mimeType: z.string().trim().min(1).max(128),
    content: z.string().max(200_000),
    conversationId: conversationIdSchema,
    expectedVersion: z.int().positive().optional(),
  })
  .strict();

export type BrandProfile = z.infer<typeof brandProfileSchema>;
export type Prospect = z.infer<typeof prospectSchema>;
export type WorkspaceFile = z.infer<typeof workspaceFileSchema>;
