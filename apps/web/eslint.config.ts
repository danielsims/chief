import { defineConfig } from "eslint/config";

import { baseConfig, restrictEnvAccess } from "@chief/eslint-config/base";
import { nextjsConfig } from "@chief/eslint-config/nextjs";
import { reactConfig } from "@chief/eslint-config/react";

export default defineConfig(
  { ignores: [".next/**", "next-env.d.ts"] },
  baseConfig,
  reactConfig,
  nextjsConfig,
  restrictEnvAccess,
);
