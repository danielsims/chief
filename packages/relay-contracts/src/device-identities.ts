import { z } from "zod";

import { hexPubkeySchema, userIdSchema } from "./identifiers";

export const bindDeviceIdentityCommandSchema = z
  .object({ accountToken: z.string().trim().min(64).max(8_192) })
  .strict();

export const boundDeviceIdentitySchema = z
  .object({
    userId: userIdSchema,
    pubkey: hexPubkeySchema,
  })
  .strict();

export type BindDeviceIdentityCommand = z.infer<
  typeof bindDeviceIdentityCommandSchema
>;
export type BoundDeviceIdentity = z.infer<typeof boundDeviceIdentitySchema>;
