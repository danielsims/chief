import type { OxlintConfig } from "oxlint";

import {
  javascriptRules,
  relayTestRules,
  sharedProjectRules,
  typescriptRules,
} from "./base-rules.ts";
import { nextjsRules, reactRules } from "./react-rules.ts";

const sourceFiles = ["**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"];
const typescriptFiles = ["**/*.{cts,mts,ts,tsx}"];
const reactFiles = [
  "apps/desktop/**/*.{ts,tsx}",
  "apps/web/**/*.{ts,tsx}",
  "packages/email/**/*.{ts,tsx}",
  "packages/ui/**/*.{ts,tsx}",
];

export const chiefOxlintConfig: OxlintConfig = {
  categories: { correctness: "off" },
  plugins: ["eslint", "import", "nextjs", "react", "typescript"],
  rules: {
    ...javascriptRules,
    ...sharedProjectRules,
  },
  overrides: [
    {
      files: sourceFiles,
      rules: { "no-undef": "error" },
    },
    {
      files: typescriptFiles,
      rules: {
        "no-undef": "off",
        ...typescriptRules,
      },
    },
    {
      files: reactFiles,
      globals: { React: "writable" },
      rules: reactRules,
    },
    {
      files: ["apps/web/**/*.{ts,tsx}"],
      rules: nextjsRules,
    },
    {
      files: [
        "apps/desktop/**/*.{js,ts,tsx}",
        "apps/web/**/*.{js,ts,tsx}",
        "packages/backend/**/*.{js,ts,tsx}",
      ],
      excludeFiles: ["**/env.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            name: "process",
            importNames: ["env"],
            message: "Import the validated env module instead.",
          },
        ],
        "no-restricted-properties": [
          "error",
          {
            object: "process",
            property: "env",
            message: "Import the validated env module instead.",
          },
        ],
      },
    },
    {
      files: ["apps/relay/test/**/*.ts"],
      rules: relayTestRules,
    },
  ],
};

export const chiefIgnorePatterns = [
  "**/*.config.*",
  "**/.cache/**",
  "**/.next/**",
  "**/.output/**",
  "**/.turbo/**",
  "**/build/**",
  "**/dist/**",
  "**/node_modules/**",
  "apps/desktop/src-tauri/**",
  "apps/mobile/.build/**",
  "apps/mobile/.deriveddata/**",
  "apps/mobile/DerivedData/**",
  "apps/mobile/Chief/Resources/agent.js",
  "apps/mobile/Chief/Vendored/**",
  "apps/relay/.wrangler/**",
  "apps/relay/worker-configuration.d.ts",
  "apps/web/next-env.d.ts",
  "packages/agent-runtime/scripts/**",
];

export const chiefEnvironments = {
  browser: true,
  builtin: true,
  node: true,
} as const;

export default chiefOxlintConfig;
