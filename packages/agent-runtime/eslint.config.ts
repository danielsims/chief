import { defineConfig } from "eslint/config";

import { baseConfig } from "@chief/eslint-config/base";

export default defineConfig({ ignores: ["dist/**", "scripts/**"] }, baseConfig);
