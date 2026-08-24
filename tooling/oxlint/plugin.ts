import { definePlugin } from "@oxlint/plugins";

import { noUndeclaredEnvironmentVariables } from "./rules/environment-rule.ts";
import {
  noAdHocTypeof,
  noAmbiguousShapeNames,
  noConditionalEmptySpread,
  noModuleMocking,
  noReflectApply,
  noReflectGet,
} from "./rules/runtime-rules.ts";
import {
  noBroadObjectParameters,
  noChainedTypeAssertions,
  noKnownValueWidening,
  noUnknownOnlyAliases,
  noUnknownParameters,
  noUnknownReturns,
  noUnsafeDictionaryValues,
  noWidenThenAssert,
  requireAssertionJustification,
} from "./rules/type-rules.ts";

export default definePlugin({
  meta: { name: "chief" },
  rules: {
    "no-ad-hoc-typeof": noAdHocTypeof,
    "no-ambiguous-shape-names": noAmbiguousShapeNames,
    "no-broad-object-parameters": noBroadObjectParameters,
    "no-chained-type-assertions": noChainedTypeAssertions,
    "no-conditional-empty-spread": noConditionalEmptySpread,
    "no-known-value-widening": noKnownValueWidening,
    "no-module-mocking": noModuleMocking,
    "no-reflect-apply": noReflectApply,
    "no-reflect-get": noReflectGet,
    "no-undeclared-environment-variables": noUndeclaredEnvironmentVariables,
    "no-unknown-only-aliases": noUnknownOnlyAliases,
    "no-unknown-parameters": noUnknownParameters,
    "no-unknown-returns": noUnknownReturns,
    "no-unsafe-dictionary-values": noUnsafeDictionaryValues,
    "no-widen-then-assert": noWidenThenAssert,
    "require-assertion-justification": requireAssertionJustification,
  },
});
