import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod/v4";

export const env = createEnv({
  server: {
    CHIEF_RELAY_URL: z.url().default("https://relay.heychief.sh"),
    GITHUB_TOKEN: z.string().min(1).optional(),
  },
  client: {},
  experimental__runtimeEnv: {},
  emptyStringAsUndefined: true,
  skipValidation:
    Boolean(process.env.CI) || process.env.npm_lifecycle_event === "lint",
});
