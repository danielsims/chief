import { defineConfig } from "oxlint";

import chiefOxlintConfig, {
  chiefEnvironments,
  chiefIgnorePatterns,
} from "@chief/oxlint-config";

import turboConfig from "./turbo.json" with { type: "json" };

const qualityRules = {
  "chief/no-ad-hoc-typeof": "error",
  "chief/no-ambiguous-shape-names": "error",
  "chief/no-broad-object-parameters": "error",
  "chief/no-chained-type-assertions": "error",
  "chief/no-conditional-empty-spread": "error",
  "chief/no-known-value-widening": "error",
  "chief/no-module-mocking": "error",
  "chief/no-reflect-apply": "error",
  "chief/no-reflect-get": "error",
  "chief/no-unknown-only-aliases": "error",
  "chief/no-unknown-parameters": "error",
  "chief/no-unknown-returns": "error",
  "chief/no-unsafe-dictionary-values": "error",
  "chief/no-widen-then-assert": "error",
  "chief/require-assertion-justification": "error",
} as const;

export default defineConfig({
  extends: [chiefOxlintConfig],
  env: chiefEnvironments,
  ignorePatterns: chiefIgnorePatterns,
  jsPlugins: ["./tooling/oxlint/plugin.ts"],
  options: {
    reportUnusedDisableDirectives: "warn",
    respectEslintDisableDirectives: false,
    typeAware: true,
  },
  rules: {
    "chief/no-undeclared-environment-variables": [
      "error",
      {
        allowed: [
          ...(turboConfig.globalEnv ?? []),
          ...(turboConfig.globalPassThroughEnv ?? []),
        ],
      },
    ],
  },
  overrides: [
    {
      files: ["**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}"],
      excludeFiles: ["tooling/oxlint/**"],
      rules: qualityRules,
    },
  ],
});
