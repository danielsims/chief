import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod/v4";

export const env = createEnv({
  server: {
    GITHUB_TOKEN: z.string().min(1).optional(),
  },
  client: {
    NEXT_PUBLIC_CONVEX_SITE_URL: z.url().optional(),
    NEXT_PUBLIC_CONVEX_URL: z.url(),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_CONVEX_SITE_URL: process.env.NEXT_PUBLIC_CONVEX_SITE_URL,
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
  },
  emptyStringAsUndefined: true,
  skipValidation:
    Boolean(process.env.CI) || process.env.npm_lifecycle_event === "lint",
});
