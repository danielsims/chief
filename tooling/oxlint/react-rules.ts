import type { OxlintConfig } from "oxlint";

type Rules = NonNullable<OxlintConfig["rules"]>;

export const reactRules: Rules = {
  "react/error-boundaries": "error",
  "react/exhaustive-deps": "warn",
  "react/globals": "error",
  "react/immutability": "error",
  "react/incompatible-library": "warn",
  "react/preserve-manual-memoization": "error",
  "react/purity": "error",
  "react/react-in-jsx-scope": "off",
  "react/refs": "error",
  "react/rules-of-hooks": "error",
  "react/set-state-in-effect": "error",
  "react/set-state-in-render": "error",
  "react/static-components": "error",
  "react/unsupported-syntax": "warn",
  "react/use-memo": "error",
  "react/void-use-memo": "error",
};

export const nextjsRules: Rules = {
  "nextjs/google-font-display": "warn",
  "nextjs/google-font-preconnect": "warn",
  "nextjs/inline-script-id": "error",
  "nextjs/next-script-for-ga": "warn",
  "nextjs/no-assign-module-variable": "error",
  "nextjs/no-async-client-component": "warn",
  "nextjs/no-before-interactive-script-outside-document": "warn",
  "nextjs/no-css-tags": "warn",
  "nextjs/no-document-import-in-page": "error",
  "nextjs/no-duplicate-head": "off",
  "nextjs/no-head-element": "warn",
  "nextjs/no-head-import-in-document": "error",
  "nextjs/no-html-link-for-pages": "error",
  "nextjs/no-img-element": "warn",
  "nextjs/no-page-custom-font": "warn",
  "nextjs/no-script-component-in-head": "error",
  "nextjs/no-styled-jsx-in-document": "warn",
  "nextjs/no-sync-scripts": "error",
  "nextjs/no-title-in-document-head": "warn",
  "nextjs/no-typos": "warn",
  "nextjs/no-unwanted-polyfillio": "warn",
};
