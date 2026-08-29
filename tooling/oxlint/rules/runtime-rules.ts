import type { Rule } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isEmptyObject, isIdentifier, propertyName } from "./rule-utils.ts";

export const noConditionalEmptySpread = defineRule({
  create(context) {
    return {
      SpreadElement(node) {
        if (node.argument.type !== "ConditionalExpression") return;
        if (
          !isEmptyObject(node.argument.consequent) &&
          !isEmptyObject(node.argument.alternate)
        ) {
          return;
        }
        context.report({
          node,
          message:
            "Build the optional properties explicitly instead of spreading an empty-object branch.",
        });
      },
    };
  },
});

export const noModuleMocking = defineRule({
  create(context) {
    const mockMethods = new Set(["doMock", "mock", "unstable_mockModule"]);
    const mockOwners = new Set(["jest", "mock", "vi"]);
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression") return;
        if (!isIdentifier(node.callee.object)) return;
        const method = propertyName(node.callee);
        if (
          method === undefined ||
          !mockOwners.has(node.callee.object.name) ||
          !mockMethods.has(method)
        ) {
          return;
        }
        context.report({
          node,
          message:
            "Inject the dependency through a real boundary instead of replacing the module at runtime.",
        });
      },
    };
  },
});

function reflectRule(method: "apply" | "get", message: string): Rule {
  return defineRule({
    create(context) {
      return {
        CallExpression(node) {
          if (node.callee.type !== "MemberExpression") return;
          if (!isIdentifier(node.callee.object, "Reflect")) return;
          if (propertyName(node.callee) !== method) return;
          context.report({ node, message });
        },
      };
    },
  });
}

export const noReflectApply = reflectRule(
  "apply",
  "Call the typed function directly instead of using Reflect.apply.",
);

export const noReflectGet = reflectRule(
  "get",
  "Use a typed property boundary instead of Reflect.get.",
);

export const noAdHocTypeof = defineRule({
  create(context) {
    return {
      UnaryExpression(node) {
        if (node.operator !== "typeof") return;
        context.report({
          node,
          message:
            "Move runtime validation to a named schema or boundary parser instead of an ad hoc typeof check.",
        });
      },
    };
  },
});

export const noAmbiguousShapeNames = defineRule({
  create(context) {
    function reportName(
      node: { name: string } & Parameters<typeof context.report>[0]["node"],
    ) {
      if (!/shape/i.test(node.name)) return;
      context.report({
        node,
        message:
          "Name this value after the domain concept it represents rather than calling it a shape.",
      });
    }

    return {
      ClassDeclaration(node) {
        if (node.id) reportName(node.id);
      },
      FunctionDeclaration(node) {
        if (node.id) reportName(node.id);
      },
      TSInterfaceDeclaration(node) {
        reportName(node.id);
      },
      TSTypeAliasDeclaration(node) {
        reportName(node.id);
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier") reportName(node.id);
      },
    };
  },
});
