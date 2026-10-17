import { z } from "zod";

const assetUrlSchema = z.url().max(2_048);

/**
 * How an agent appears. An image or sprite always points at the relay's own
 * copy, so viewers never load a third-party URL. A sprite follows the common
 * pet-pack layout: a grid sheet whose first frames, read row by row, loop as
 * the agent's idle animation. A style draws the avatar from design values.
 */
export const agentAvatarSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), url: assetUrlSchema }).strict(),
  z
    .object({
      kind: z.literal("sprite"),
      url: assetUrlSchema,
      columns: z.int().min(1).max(32),
      rows: z.int().min(1).max(32),
      frames: z.int().min(1).max(1_024),
      fps: z.int().min(1).max(30),
    })
    .strict()
    .refine((sprite) => sprite.frames <= sprite.columns * sprite.rows, {
      message: "A sprite cannot have more frames than its grid holds.",
      path: ["frames"],
    }),
  z
    .object({
      kind: z.literal("style"),
      color: z.string().regex(/^#[0-9a-f]{6}$/iu),
      shape: z.enum(["circle", "rounded", "square"]),
      glyph: z.string().trim().min(1).max(2).optional(),
    })
    .strict(),
]);

export const agentAvatarSetSchema = z
  .object({ avatar: agentAvatarSchema.nullable() })
  .strict();

export const agentAvatarSetResultSchema = z
  .object({
    agentId: z.string().trim().min(1).max(128),
    avatar: agentAvatarSchema.nullable(),
  })
  .strict();

export type AgentAvatar = z.infer<typeof agentAvatarSchema>;
export type AgentAvatarSet = z.infer<typeof agentAvatarSetSchema>;
