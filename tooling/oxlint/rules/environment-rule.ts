import { defineRule } from "@oxlint/plugins";

import { isIdentifier, propertyName } from "./rule-utils.ts";

interface EnvironmentRuleOptions {
  allowed?: string[];
}

export const noUndeclaredEnvironmentVariables = defineRule({
  meta: {
    schema: [
      {
        type: "object",
        properties: {
          allowed: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = (context.options[0] ?? {}) as EnvironmentRuleOptions;
    const allowed = (options.allowed ?? []).map((pattern) => {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`^${escaped.replaceAll("\\*", ".*")}$`);
    });

    return {
      MemberExpression(node) {
        if (node.object.type !== "MemberExpression") return;
        if (!isIdentifier(node.object.object, "process")) return;
        if (propertyName(node.object) !== "env") return;
        const variable = propertyName(node);
        if (
          variable === undefined ||
          allowed.some((pattern) => pattern.test(variable))
        ) {
          return;
        }
        context.report({
          node,
          message: `Declare ${variable} in turbo.json before reading it from process.env.`,
        });
      },
    };
  },
});
