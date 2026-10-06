import { z } from "zod";

import { userIdSchema } from "./identifiers";

/** The body silhouettes a Grok Bot's `profile.json` names as `avatarShape`. */
export const grokBotSilhouettes = [
  "blob",
  "pebble",
  "bean",
  "egg",
  "squircle",
  "tablet",
  "capsule",
  "cylinder",
  "hex",
  "gem",
  "crystal",
  "wedge",
  "shield",
  "dome",
  "arch",
  "cloud",
  "teardrop",
  "leaf",
] as const;

/** The colours a Grok Bot's `profile.json` names as `avatarColor`. */
export const grokBotColors = [
  "black",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "violet",
  "magenta",
  "gray",
] as const;

/** What an outside agent runs on, so people can tell them apart at a
 * glance. A fixed list, so one product is never three different avatars. */
export const guestProviders = [
  "claude",
  "openai",
  "grok",
  "gemini",
  "opencode",
  "openclaw",
  "hermes",
  "other",
] as const;

export const guestProviderSchema = z.enum(guestProviders);

/** A drawn avatar for agents that have no picture, such as Grok Bots. Only
 * these fixed values are ever stored or rendered. */
export const guestMarkSchema = z
  .object({
    style: z.literal("grok-bot"),
    shape: z.enum(grokBotSilhouettes),
    color: z.enum(grokBotColors),
  })
  .strict();

/** The workspace member a guest works for. Only ever set by the relay, from a
 * personal invite that member created; never from anything a guest says. */
export const guestOperatorSchema = z
  .object({
    id: userIdSchema,
    name: z.string().trim().min(1).max(80),
  })
  .strict();

/** How a guest appears wherever it is shown. */
export const guestProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    /** Profiles stored before providers existed read as "other". */
    provider: guestProviderSchema.default("other"),
    model: z.string().trim().min(1).max(80).optional(),
    /** Relay-hosted copy of the agent's own profile image. */
    image: z.url().max(2_048).optional(),
    mark: guestMarkSchema.optional(),
    operator: guestOperatorSchema.optional(),
  })
  .strict();

export type GrokBotSilhouette = (typeof grokBotSilhouettes)[number];
export type GrokBotColor = (typeof grokBotColors)[number];
export type GuestProvider = z.infer<typeof guestProviderSchema>;
export type GuestMark = z.infer<typeof guestMarkSchema>;
export type GuestOperator = z.infer<typeof guestOperatorSchema>;
export type GuestProfile = z.infer<typeof guestProfileSchema>;
