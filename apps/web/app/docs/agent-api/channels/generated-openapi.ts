import { z } from "zod";

import generatedOpenApi from "../../../../generated/local-tools-openapi.json";

export type JsonExample =
  | boolean
  | number
  | string
  | null
  | JsonExample[]
  | { [key: string]: JsonExample };

export interface JsonSchema {
  $ref?: string;
  type?: string;
  enum?: JsonExample[];
  format?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
}

const jsonExample: z.ZodType<JsonExample> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.number(),
    z.string(),
    z.null(),
    z.array(jsonExample),
    z.record(z.string(), jsonExample),
  ]),
);

const jsonSchema: z.ZodType<JsonSchema> = z.lazy(() =>
  z.object({
    $ref: z.string().optional(),
    type: z.string().optional(),
    enum: z.array(jsonExample).optional(),
    format: z.string().optional(),
    description: z.string().optional(),
    properties: z.record(z.string(), jsonSchema).optional(),
    required: z.array(z.string()).optional(),
    items: jsonSchema.optional(),
  }),
);

const requestBodySchema = z.object({
  content: z.object({
    "application/json": z.object({ schema: jsonSchema }),
  }),
});

const parameterSchema = z.object({
  name: z.string(),
  in: z.enum(["path", "query"]),
  required: z.boolean(),
  description: z.string().optional(),
  schema: jsonSchema,
});

const operationSchema = z.object({
  operationId: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  requestBody: z.unknown().optional(),
  parameters: z.array(z.unknown()).optional(),
  responses: z.record(z.string(), z.unknown()),
});

const pathItemSchema = z.object({
  get: operationSchema.optional(),
  post: operationSchema.optional(),
  patch: operationSchema.optional(),
  delete: operationSchema.optional(),
});

const generatedDocumentSchema = z.object({
  openapi: z.string(),
  info: z.object({
    title: z.string(),
    version: z.string(),
    description: z.string(),
  }),
  servers: z.array(z.object({ url: z.string() })),
  security: z.array(z.record(z.string(), z.array(z.string()))),
  paths: z.record(z.string(), pathItemSchema),
  components: z.object({
    securitySchemes: z.record(z.string(), z.unknown()),
  }),
});

export const generatedDocument =
  generatedDocumentSchema.parse(generatedOpenApi);

const openApiMethods = ["get", "post", "patch", "delete"] as const;
const methodLabels = {
  get: "GET",
  post: "POST",
  patch: "PATCH",
  delete: "DELETE",
} as const;

export function generatedOperation(operationId: string) {
  for (const [path, pathItem] of Object.entries(generatedDocument.paths)) {
    for (const method of openApiMethods) {
      const operation = pathItem[method];
      if (operation?.operationId === operationId) {
        return { method: methodLabels[method], operation, path };
      }
    }
  }
  throw new Error(`The composed local tool ${operationId} is unavailable.`);
}

export function requestSchemaOf(operationId: string): JsonSchema | undefined {
  const requestBody = generatedOperation(operationId).operation.requestBody;
  if (!requestBody) return undefined;
  const parsed = requestBodySchema.safeParse(requestBody);
  if (!parsed.success) {
    throw new Error(
      `The composed local tool ${operationId} has an invalid request schema.`,
    );
  }
  return parsed.data.content["application/json"].schema;
}

export function parametersOf(operationId: string) {
  const parameters = generatedOperation(operationId).operation.parameters ?? [];
  const parsed = z.array(parameterSchema).safeParse(parameters);
  if (!parsed.success) {
    throw new Error(
      `The composed local tool ${operationId} has invalid parameters.`,
    );
  }
  return parsed.data;
}
