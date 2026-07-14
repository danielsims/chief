import { defineConfig } from "eslint/config";

import { baseConfig } from "@chief/eslint-config/base";
import { reactConfig } from "@chief/eslint-config/react";

export default defineConfig({ ignores: ["dist/**"] }, baseConfig, reactConfig);
