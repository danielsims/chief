import { defineConfig } from "eslint/config";

import { baseConfig } from "@chief/eslint-config/base";

export default defineConfig(baseConfig, {
  files: ["test/**/*.ts"],
  rules: {
    "@typescript-eslint/array-type": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-return": "off",
    "@typescript-eslint/no-unnecessary-type-assertion": "off",
    "@typescript-eslint/require-await": "off",
  },
});
