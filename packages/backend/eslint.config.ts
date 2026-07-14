import { defineConfig } from "eslint/config";

import { baseConfig, restrictEnvAccess } from "@chief/eslint-config/base";

export default defineConfig(
  {
    ignores: ["convex/_generated/**", "convex/betterAuth/_generated/**"],
  },
  baseConfig,
  restrictEnvAccess,
);
