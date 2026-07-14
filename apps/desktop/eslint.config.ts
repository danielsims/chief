import { defineConfig } from "eslint/config";

import { baseConfig, restrictEnvAccess } from "@chief/eslint-config/base";
import { reactConfig } from "@chief/eslint-config/react";

export default defineConfig(
  { ignores: ["dist/**", "src-tauri/**"] },
  baseConfig,
  reactConfig,
  restrictEnvAccess,
);
