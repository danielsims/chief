import { z } from "zod";

export type AuthenticationMethod = "email-password" | "google" | "apple";

const relayAuthenticationSchema = z.object({
  authentication: z.object({
    methods: z
      .array(z.enum(["email-password", "google", "apple"]))
      .optional()
      .default(["google"]),
  }),
});

/** Sign-in methods advertised by the relay's discovery document. */
export function parseAuthenticationMethods(
  value: unknown,
): AuthenticationMethod[] {
  return relayAuthenticationSchema.parse(value).authentication.methods;
}
