import type { JsonExample, JsonSchema } from "./generated-openapi";
import {
  generatedDocument,
  parametersOf,
  requestSchemaOf,
  responseSchemaOf,
} from "./generated-openapi";

/**
 * Transforms the generated relay OpenAPI document into a plain, serializable
 * model the docs UI renders from. Everything is derived — the document is the
 * only source of truth.
 */

export interface DocField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface DocResponse {
  status: string;
  description: string;
}

export interface DocOperation {
  id: string;
  method: string;
  path: string;
  summary: string;
  description?: string;
  params: DocField[];
  bodyFields: DocField[];
  responses: DocResponse[];
  requestSample: string;
  responseSample?: string;
}

export interface DocGroup {
  tag: string;
  description?: string;
  operations: DocOperation[];
}

export interface DocModel {
  name: string;
  description?: string;
  fields: DocField[];
  sample: string;
}

export interface DocsModel {
  title: string;
  version: string;
  description: string;
  baseUrl: string;
  groups: DocGroup[];
  models: DocModel[];
}

type SchemaMap = Record<string, JsonSchema>;

const methods = ["get", "post", "patch", "delete", "put"] as const;

function defsOf(root: JsonSchema | undefined): SchemaMap {
  return root?.$defs ?? {};
}

function resolve(schema: JsonSchema, defs: SchemaMap): JsonSchema {
  if (schema.$ref) {
    const name = schema.$ref.split("/").pop() ?? "";
    return defs[name] ?? schema;
  }
  return schema;
}

function isNullSchema(schema: JsonSchema, defs: SchemaMap): boolean {
  const resolved = resolve(schema, defs);
  return resolved.type === "null" || resolved.const === null;
}

/** Human type label: "string", `"a" | "b"`, "datetime", "object[]" */
function typeLabel(schema: JsonSchema, defs: SchemaMap): string {
  const resolved = resolve(schema, defs);
  if (resolved.const !== undefined) return JSON.stringify(resolved.const);
  if (resolved.enum) {
    return resolved.enum.map((value) => JSON.stringify(value)).join(" | ");
  }
  const variants = resolved.oneOf ?? resolved.anyOf;
  if (variants) {
    const named = variants.filter((variant) => !isNullSchema(variant, defs));
    const chosen = named.length > 0 ? named : variants;
    const labels = chosen.map((variant) => typeLabel(variant, defs));
    return [...new Set(labels)].join(" | ");
  }
  if (resolved.allOf) {
    return resolved.allOf
      .map((variant) => typeLabel(variant, defs))
      .join(" & ");
  }
  const type = Array.isArray(resolved.type)
    ? (resolved.type.find((item) => item !== "null") ?? resolved.type[0])
    : resolved.type;
  if (type === "array" && resolved.items) {
    return `${typeLabel(resolved.items, defs)}[]`;
  }
  if (type === "string" && resolved.format === "date-time") return "datetime";
  if (type === "string" && resolved.format === "uri") return "url";
  if (!type && resolved.properties) return "object";
  return type ?? "object";
}

function fieldsOf(schema: JsonSchema, defs: SchemaMap): DocField[] {
  const resolved = resolve(schema, defs);
  if (!resolved.properties) return [];
  const required = new Set(resolved.required ?? []);
  return Object.entries(resolved.properties).map(([name, prop]) => ({
    name,
    type: typeLabel(prop, defs),
    required: required.has(name),
    description: resolve(prop, defs).description ?? prop.description,
  }));
}

/** Builds an example by walking the schema, preferring declared examples
    and falling back to type defaults. Arrays are shown with one element. */
function exampleOf(
  schema: JsonSchema,
  defs: SchemaMap,
  depth = 0,
): JsonExample {
  const resolved = resolve(schema, defs);
  if (resolved.example !== undefined) return resolved.example;
  if (depth > 6) return null;
  if (resolved.const !== undefined) return resolved.const;
  if (resolved.enum && resolved.enum.length > 0)
    return resolved.enum[0] ?? null;
  const variants = resolved.oneOf ?? resolved.anyOf;
  if (variants) {
    const named = variants.filter((variant) => !isNullSchema(variant, defs));
    const chosen = named[0] ?? variants[0];
    return chosen ? exampleOf(chosen, defs, depth + 1) : null;
  }
  const type = Array.isArray(resolved.type)
    ? (resolved.type.find((item) => item !== "null") ?? resolved.type[0])
    : resolved.type;
  if (resolved.properties || type === "object") {
    return Object.fromEntries(
      Object.entries(resolved.properties ?? {}).map(([name, prop]) => [
        name,
        exampleOf(prop, defs, depth + 1),
      ]),
    );
  }
  if ((type === "array" || resolved.items) && resolved.items) {
    return [exampleOf(resolved.items, defs, depth + 1)];
  }
  if (type === "string") {
    if (resolved.format === "date-time") return "2026-06-11T09:30:00.000Z";
    if (resolved.format === "uri") return "https://relay.heychief.sh/example";
    return "string";
  }
  if (type === "number" || type === "integer") return 0;
  if (type === "boolean") return true;
  if (type === "null") return null;
  return null;
}

function indentJson(value: JsonExample, offset: number): string {
  return JSON.stringify(value, null, 2)
    .split("\n")
    .map((line, index) => (index === 0 ? line : " ".repeat(offset) + line))
    .join("\n");
}

function curlFor(
  method: string,
  baseUrl: string,
  path: string,
  bodyExample: JsonExample | undefined,
  authenticated: boolean,
): string {
  const parts = [
    `curl ${method === "GET" ? "" : `-X ${method} `}${baseUrl}${path}`,
  ];
  if (authenticated) {
    parts.push(`-H "Authorization: Nostr $CHIEF_RELAY_AUTH"`);
  }
  if (bodyExample !== undefined) {
    parts.push(`-H "Content-Type: application/json"`);
    parts.push(`-d '${indentJson(bodyExample, 2)}'`);
  }
  return parts.join(" \\\n  ");
}

export function buildDocsModel(): DocsModel {
  const doc = generatedDocument;
  const baseUrl = doc.servers[0]?.url ?? "https://relay.heychief.sh";

  const groups: DocGroup[] = doc.tags.map((tag) => ({
    tag: tag.name,
    description: tag.description,
    operations: [],
  }));

  for (const [path, pathItem] of Object.entries(doc.paths)) {
    for (const method of methods) {
      const op = pathItem[method];
      if (!op) continue;
      const group = groups.find((candidate) => candidate.tag === op.tags?.[0]);
      if (!group) continue;

      const requestSchema = requestSchemaOf(op.operationId);
      const responseSchema = responseSchemaOf(op.operationId);
      const requestDefs = defsOf(requestSchema);
      const responseDefs = defsOf(responseSchema);
      const authenticated = !(
        Array.isArray(op.security) && op.security.length === 0
      );

      group.operations.push({
        id: op.operationId,
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? path,
        description: op.description,
        params: parametersOf(op.operationId).map((parameter) => ({
          name: parameter.name,
          type: parameter.schema ? typeLabel(parameter.schema, {}) : "string",
          required: parameter.required ?? false,
          description: parameter.description,
        })),
        bodyFields: requestSchema ? fieldsOf(requestSchema, requestDefs) : [],
        responses: Object.entries(op.responses).map(([status, response]) => ({
          status,
          description: response.description ?? "",
        })),
        requestSample: curlFor(
          method.toUpperCase(),
          baseUrl,
          path,
          requestSchema ? exampleOf(requestSchema, requestDefs) : undefined,
          authenticated,
        ),
        responseSample: responseSchema
          ? JSON.stringify(exampleOf(responseSchema, responseDefs), null, 2)
          : undefined,
      });
    }
  }

  const models: DocModel[] = Object.entries(doc.components.schemas).map(
    ([name, schema]) => ({
      name,
      description: schema.description,
      fields: fieldsOf(schema, defsOf(schema)),
      sample: JSON.stringify(exampleOf(schema, defsOf(schema)), null, 2),
    }),
  );

  return {
    title: doc.info.title,
    version: doc.info.version,
    description: doc.info.description,
    baseUrl,
    groups: groups.filter((group) => group.operations.length > 0),
    models,
  };
}
