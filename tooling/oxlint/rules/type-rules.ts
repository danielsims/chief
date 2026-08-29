import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import {
  findAncestor,
  isBroadPrimitiveType,
  isFunctionNode,
  isIdentifier,
  isUnsafeBoundaryType,
} from "./rule-utils.ts";

export const noChainedTypeAssertions = defineRule({
  create(context) {
    return {
      TSAsExpression(node) {
        if (
          node.expression.type !== "TSAsExpression" &&
          node.expression.type !== "TSTypeAssertion"
        ) {
          return;
        }
        context.report({
          node,
          message:
            "Replace chained assertions with validation or a single justified boundary assertion.",
        });
      },
      TSTypeAssertion(node) {
        if (
          node.expression.type !== "TSAsExpression" &&
          node.expression.type !== "TSTypeAssertion"
        ) {
          return;
        }
        context.report({
          node,
          message:
            "Replace chained assertions with validation or a single justified boundary assertion.",
        });
      },
    };
  },
});

function literalMatchesType(
  value: ESTree.Expression,
  annotation: ESTree.TSType,
): boolean {
  if (value.type !== "Literal") return false;
  if (annotation.type === "TSStringKeyword")
    return typeof value.value === "string";
  if (annotation.type === "TSNumberKeyword")
    return typeof value.value === "number";
  if (annotation.type === "TSBooleanKeyword")
    return typeof value.value === "boolean";
  return false;
}

export const noKnownValueWidening = defineRule({
  create(context) {
    return {
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier" || node.init === null) return;
        const typeAnnotation = node.id.typeAnnotation;
        const annotation = typeAnnotation?.typeAnnotation;
        if (
          !typeAnnotation ||
          !annotation ||
          !literalMatchesType(node.init, annotation)
        ) {
          return;
        }
        context.report({
          node: typeAnnotation,
          message:
            "Let this known value retain its literal type instead of widening it at declaration.",
        });
      },
    };
  },
});

export const noBroadObjectParameters = defineRule({
  create(context) {
    return {
      TSObjectKeyword(node) {
        const owner = findAncestor(node, isFunctionNode, 3);
        if (!owner) return;
        context.report({
          node,
          message:
            "Model the parameter's required fields instead of accepting the broad object type.",
        });
      },
    };
  },
});

function annotationRole(
  node: ESTree.TSUnknownKeyword,
): "parameter" | "return" | undefined {
  let candidate: ESTree.Node | null = node.parent;
  for (let depth = 0; depth < 4; depth += 1) {
    if (candidate === null) return undefined;
    if (candidate.type === "TSTypeAnnotation") {
      const owner: ESTree.Node | null = candidate.parent;
      if (
        isFunctionNode(owner) &&
        "returnType" in owner &&
        owner.returnType === candidate
      ) {
        return "return";
      }
    }
    if (isFunctionNode(candidate)) return "parameter";
    candidate = candidate.parent;
  }
  return undefined;
}

export const noUnknownParameters = defineRule({
  create(context) {
    function isPromiseRejectionParameter(node: ESTree.TSUnknownKeyword) {
      let candidate: ESTree.Node | null = node.parent;
      for (let depth = 0; candidate !== null && depth < 6; depth += 1) {
        if (
          candidate.type === "CallExpression" &&
          candidate.callee.type === "MemberExpression" &&
          !candidate.callee.computed &&
          candidate.callee.property.type === "Identifier" &&
          candidate.callee.property.name === "catch"
        ) {
          return true;
        }
        candidate = candidate.parent;
      }
      return false;
    }

    function isTypeGuardParameter(node: ESTree.TSUnknownKeyword) {
      let candidate: ESTree.Node | null = node.parent;
      for (let depth = 0; candidate !== null && depth < 4; depth += 1) {
        if (!isFunctionNode(candidate)) {
          candidate = candidate.parent;
          continue;
        }
        return (
          "returnType" in candidate &&
          candidate.returnType?.typeAnnotation.type === "TSTypePredicate"
        );
      }
      return false;
    }

    function isBoundaryParserParameter(node: ESTree.TSUnknownKeyword) {
      let candidate: ESTree.Node | null = node.parent;
      for (let depth = 0; candidate !== null && depth < 5; depth += 1) {
        if (!isFunctionNode(candidate)) {
          candidate = candidate.parent;
          continue;
        }
        const parent = candidate.parent;
        const name =
          candidate.type === "FunctionDeclaration"
            ? candidate.id?.name
            : parent?.type === "VariableDeclarator" &&
                parent.id.type === "Identifier"
              ? parent.id.name
              : undefined;
        return /^(is|has|parse|validate|record|text|string|object)/.test(
          name ?? "",
        );
      }
      return false;
    }

    return {
      TSUnknownKeyword(node) {
        if (
          annotationRole(node) !== "parameter" ||
          isPromiseRejectionParameter(node) ||
          isTypeGuardParameter(node) ||
          isBoundaryParserParameter(node)
        ) {
          return;
        }
        context.report({
          node,
          message:
            "Parse unknown input at the boundary and pass a named domain type into the function.",
        });
      },
    };
  },
});

export const noUnknownReturns = defineRule({
  create(context) {
    return {
      TSUnknownKeyword(node) {
        if (annotationRole(node) !== "return") return;
        context.report({
          node,
          message:
            "Return a named result type and keep unknown values inside the boundary parser.",
        });
      },
    };
  },
});

export const noUnknownOnlyAliases = defineRule({
  create(context) {
    return {
      TSTypeAliasDeclaration(node) {
        if (node.typeAnnotation.type !== "TSUnknownKeyword") return;
        context.report({
          node,
          message:
            "Replace this unknown-only alias with a real domain type or validate at the boundary.",
        });
      },
    };
  },
});

export const noUnsafeDictionaryValues = defineRule({
  create(context) {
    return {
      TSIndexSignature(node) {
        if (!isUnsafeBoundaryType(node.typeAnnotation.typeAnnotation)) return;
        context.report({
          node: node.typeAnnotation.typeAnnotation,
          message:
            "Give dictionary values a concrete domain type instead of an unchecked catch-all.",
        });
      },
      TSTypeReference(node) {
        if (!isIdentifier(node.typeName, "Record")) return;
        const valueType = node.typeArguments?.params[1];
        if (!valueType || !isUnsafeBoundaryType(valueType)) return;
        context.report({
          node: valueType,
          message:
            "Give Record values a concrete domain type instead of an unchecked catch-all.",
        });
      },
    };
  },
});

export const noWidenThenAssert = defineRule({
  create(context) {
    return {
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier" || node.init === null) return;
        const annotation = node.id.typeAnnotation?.typeAnnotation;
        if (!isBroadPrimitiveType(annotation)) return;
        if (
          node.init.type !== "TSAsExpression" &&
          node.init.type !== "TSTypeAssertion"
        ) {
          return;
        }
        context.report({
          node,
          message:
            "Do not widen a value and immediately assert it. Preserve or validate the precise type.",
        });
      },
    };
  },
});

export const requireAssertionJustification = defineRule({
  create(context) {
    function parentOf(node: ESTree.Node): ESTree.Node | null {
      return node.parent;
    }

    function checkAssertion(
      node: ESTree.TSAsExpression | ESTree.TSTypeAssertion,
    ) {
      if (context.sourceCode.getText(node.typeAnnotation) === "const") return;
      const comments = [];
      let candidate: ESTree.Node | null = node;
      for (let depth = 0; candidate !== null && depth < 4; depth += 1) {
        comments.push(...context.sourceCode.getCommentsBefore(candidate));
        candidate = parentOf(candidate);
      }
      const hasJustification = comments.some((comment) => {
        const text = comment.value.trim();
        return (
          text.length >= 12 &&
          /because|checked|guaranteed|invariant|safe|trusted|validated/i.test(
            text,
          )
        );
      });
      if (hasJustification) return;
      context.report({
        node,
        message:
          "Validate this value or add a nearby comment explaining the invariant that makes the assertion safe.",
      });
    }

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
