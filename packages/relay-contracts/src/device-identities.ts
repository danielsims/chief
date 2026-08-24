import { z } from "zod";

import {
  hexPubkeySchema,
  isoDateTimeSchema,
  userIdSchema,
} from "./identifiers";

export const bindDeviceIdentityCommandSchema = z
  // Better Auth opaque access tokens are currently 43 characters. Treat the
  // token as an opaque credential: bound its transport size without assuming
  // a JWT-shaped minimum length.
  .object({ accountToken: z.string().trim().min(32).max(8_192) })
  .strict();

export const boundDeviceIdentitySchema = z
  .object({
    userId: userIdSchema,
    pubkey: hexPubkeySchema,
    deviceAuthorization: z.string().trim().min(32).max(8_192),
    expiresAt: isoDateTimeSchema,
  })
  .strict();

export type BindDeviceIdentityCommand = z.infer<
  typeof bindDeviceIdentityCommandSchema
>;
export type BoundDeviceIdentity = z.infer<typeof boundDeviceIdentitySchema>;
