import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod/v4";

export const env = createEnv({
  server: {
    CHIEF_RELAY_URL: z.url().default("https://relay.heychief.sh"),
    // The relay origin a browser sees, used to scope invitations to the relay
    // this deployment fronts. Hosted heychief.sh proxies to relay.heychief.sh,
    // so it defaults to CHIEF_RELAY_URL; self-host sets it to its public URL.
    CHIEF_PUBLIC_RELAY_URL: z.url().optional(),
    GITHUB_TOKEN: z.string().min(1).optional(),
  },
  client: {},
  experimental__runtimeEnv: {},
  emptyStringAsUndefined: true,
  skipValidation:
    Boolean(process.env.CI) || process.env.npm_lifecycle_event === "lint",
});
