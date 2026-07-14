import { createEnv } from "@t3-oss/env-core";
import { z } from "zod/v4";

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_AUTH_BASE_URL: z.url().optional(),
    VITE_CONVEX_URL: z.url(),
    VITE_WORKSPACE_APP_PATH: z.string().min(1).optional(),
  },
  runtimeEnv: import.meta.env,
  emptyStringAsUndefined: true,
});
