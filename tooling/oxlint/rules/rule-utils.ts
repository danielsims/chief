import type { ESTree } from "@oxlint/plugins";

export function isIdentifier(
  node: ESTree.Node | null | undefined,
  name?: string,
): node is ESTree.IdentifierName | ESTree.IdentifierReference {
  return (
    node?.type === "Identifier" && (name === undefined || node.name === name)
  );
}

export function isEmptyObject(
  node: ESTree.Node | null | undefined,
): node is ESTree.ObjectExpression {
  return node?.type === "ObjectExpression" && node.properties.length === 0;
}

export function isBroadPrimitiveType(
  node: ESTree.Node | null | undefined,
): boolean {
  return (
    node?.type === "TSStringKeyword" ||
    node?.type === "TSNumberKeyword" ||
    node?.type === "TSBooleanKeyword"
  );
}

export function isUnsafeBoundaryType(
  node: ESTree.Node | null | undefined,
): boolean {
  return (
    node?.type === "TSAnyKeyword" ||
    node?.type === "TSObjectKeyword" ||
    node?.type === "TSUnknownKeyword"
  );
}

export function propertyName(
  member: ESTree.MemberExpression,
): string | undefined {
  if (!member.computed && member.property.type === "Identifier") {
    return member.property.name;
  }
  if (member.computed && member.property.type === "Literal") {
    return typeof member.property.value === "string"
      ? member.property.value
      : undefined;
  }
  return undefined;
}

export function isFunctionNode(node: ESTree.Node): boolean {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "TSDeclareFunction" ||
    node.type === "TSEmptyBodyFunctionExpression" ||
    node.type === "TSFunctionType" ||
    node.type === "TSMethodSignature"
  );
}

export function findAncestor(
  node: ESTree.Node,
  predicate: (candidate: ESTree.Node) => boolean,
  maximumDepth = 4,
): ESTree.Node | undefined {
  let candidate = node.parent;
  let depth = 0;
  while (candidate && depth < maximumDepth) {
    if (predicate(candidate)) return candidate;
    candidate = candidate.parent;
    depth += 1;
  }
  return undefined;
}
