import { z } from "zod";

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 24;

/** Names that would read as Chief itself, staff, or a broadcast mention. */
export const reservedUsernames: readonly string[] = [
  "chief",
  "admin",
  "system",
  "support",
  "root",
  "api",
  "relay",
  "everyone",
  "here",
  "administrator",
  "relay",
  "help",
  "owner",
  "agent",
  "agents",
  "channel",
  "www",
  "security",
];

export function isReservedUsername(username: string) {
  return reservedUsernames.includes(username.trim().toLowerCase());
}

/** Shape rules only. Input is trimmed and lowercased, so uniqueness is
 * case-insensitive by construction. */
export const usernameFormatSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(USERNAME_MIN_LENGTH, {
    message: `Usernames need at least ${USERNAME_MIN_LENGTH} characters.`,
  })
  .max(USERNAME_MAX_LENGTH, {
    message: `Usernames can be at most ${USERNAME_MAX_LENGTH} characters.`,
  })
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u, {
    message:
      "Use lowercase letters, digits and hyphens, starting and ending with a letter or digit.",
  })
  .refine((value) => !value.includes("--"), "Avoid consecutive hyphens.");

export const reservedUsernameMessage = "That username is reserved.";

/** Every rule the relay enforces before checking whether a name is taken. */
export const usernameSchema = usernameFormatSchema.refine(
  (username) => !isReservedUsername(username),
  { message: reservedUsernameMessage },
);
export type Username = z.infer<typeof usernameSchema>;

export const usernameUnavailableReasonSchema = z.enum([
  "invalid",
  "reserved",
  "taken",
]);
export type UsernameUnavailableReason = z.infer<
  typeof usernameUnavailableReasonSchema
>;

export const usernameAvailabilitySchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(true), username: usernameSchema }).strict(),
  z
    .object({
      available: z.literal(false),
      username: z.string(),
      reason: usernameUnavailableReasonSchema,
      message: z.string(),
    })
    .strict(),
]);
export type UsernameAvailability = z.infer<typeof usernameAvailabilitySchema>;

export const usernameSetCommandSchema = z
  .object({ username: z.string().max(256) })
  .strict();

export const usernameSetResultSchema = z
  .object({ username: usernameSchema })
  .strict();
export type UsernameSetResult = z.infer<typeof usernameSetResultSchema>;

export const usernameTakenMessage = "That username is already taken.";

/** Checks the rules locally; `taken` can only come from the relay. */
export function usernameIssue(input: string):
  | { ok: true; username: string }
  | {
      ok: false;
      username: string;
      reason: Exclude<UsernameUnavailableReason, "taken">;
      message: string;
    } {
  const normalized = input.trim().toLowerCase();
  const format = usernameFormatSchema.safeParse(input);
  if (!format.success) {
    return {
      ok: false,
      username: normalized,
      reason: "invalid",
      message: format.error.issues[0]?.message ?? "That username is invalid.",
    };
  }
  if (isReservedUsername(format.data)) {
    return {
      ok: false,
      username: format.data,
      reason: "reserved",
      message: reservedUsernameMessage,
    };
  }
  return { ok: true, username: format.data };
}

export const accountProfileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    username: usernameSchema.nullable(),
    image: z.string().nullable(),
  })
  .strict();
export type AccountProfile = z.infer<typeof accountProfileSchema>;
