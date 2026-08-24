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
      excludeFiles: ["apps/workspace/**"],
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
    {
      files: ["apps/workspace/**/*.{js,mjs,ts}"],
      rules: {
        "max-lines": ["error", { max: 500 }],
        "no-undef": "off",
        "typescript/ban-ts-comment": "error",
        "typescript/no-duplicate-enum-values": "error",
        "typescript/no-empty-object-type": "error",
        "typescript/no-explicit-any": "error",
        "typescript/no-extra-non-null-assertion": "error",
        "typescript/no-misused-new": "error",
        "typescript/no-namespace": "error",
        "typescript/no-non-null-asserted-optional-chain": "error",
        "typescript/no-require-imports": "error",
        "typescript/no-this-alias": "error",
        "typescript/no-unnecessary-type-constraint": "error",
        "typescript/no-unsafe-declaration-merging": "error",
        "typescript/no-unsafe-function-type": "error",
        "typescript/no-wrapper-object-types": "error",
        "typescript/prefer-as-const": "error",
        "typescript/prefer-namespace-keyword": "error",
        "typescript/triple-slash-reference": "error",
      },
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
  "apps/workspace/.eve/**",
  "apps/workspace/.workflow-data/**",
  "packages/agent-runtime/scripts/**",
  "packages/agent-runtime/templates/**/convex/_generated/**",
];

export const chiefEnvironments = {
  browser: true,
  builtin: true,
  node: true,
} as const;

export default chiefOxlintConfig;
