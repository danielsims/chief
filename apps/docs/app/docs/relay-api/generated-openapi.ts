import { z } from "zod";

import generatedOpenApi from "../../../generated/relay-openapi.json";

export type JsonExample =
  | boolean
  | number
  | string
  | null
  | JsonExample[]
  | { [key: string]: JsonExample };

export interface JsonSchema {
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  type?: string | string[];
  enum?: JsonExample[];
  const?: JsonExample;
  example?: JsonExample;
  default?: JsonExample;
  format?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
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
  z
    .object({
      $ref: z.string().optional(),
      $defs: z.record(z.string(), jsonSchema).optional(),
      type: z.union([z.string(), z.array(z.string())]).optional(),
      enum: z.array(jsonExample).optional(),
      const: jsonExample.optional(),
      example: jsonExample.optional(),
      default: jsonExample.optional(),
      format: z.string().optional(),
      description: z.string().optional(),
      properties: z.record(z.string(), jsonSchema).optional(),
      required: z.array(z.string()).optional(),
      items: jsonSchema.optional(),
      anyOf: z.array(jsonSchema).optional(),
      oneOf: z.array(jsonSchema).optional(),
      allOf: z.array(jsonSchema).optional(),
      additionalProperties: z.union([z.boolean(), jsonSchema]).optional(),
    })
    .catchall(z.unknown()),
);

const contentSchema = z.object({
  schema: jsonSchema,
});

const requestBodySchema = z.object({
  required: z.boolean().optional(),
  content: z.record(z.string(), contentSchema),
});

const responseObjectSchema = z.object({
  description: z.string().optional(),
  content: z.record(z.string(), contentSchema).optional(),
});

const parameterSchema = z.object({
  name: z.string(),
  in: z.string(),
  required: z.boolean().optional(),
  description: z.string().optional(),
  schema: jsonSchema.optional(),
});

const operationSchema = z.object({
  operationId: z.string(),
  summary: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  security: z.array(z.record(z.string(), z.array(z.string()))).optional(),
  parameters: z.array(z.unknown()).optional(),
  requestBody: z.unknown().optional(),
  responses: z.record(z.string(), responseObjectSchema),
});

const pathItemSchema = z.object({
  get: operationSchema.optional(),
  post: operationSchema.optional(),
  patch: operationSchema.optional(),
  delete: operationSchema.optional(),
  put: operationSchema.optional(),
});

const generatedDocumentSchema = z.object({
  openapi: z.string(),
  info: z.object({
    title: z.string(),
    version: z.string(),
    description: z.string(),
  }),
  servers: z.array(z.object({ url: z.string() })),
  tags: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
    }),
  ),
  security: z.array(z.record(z.string(), z.array(z.string()))).optional(),
  paths: z.record(z.string(), pathItemSchema),
  components: z.object({
    schemas: z.record(z.string(), jsonSchema),
  }),
});

export const generatedDocument =
  generatedDocumentSchema.parse(generatedOpenApi);

export type GeneratedDocument = typeof generatedDocument;
export type OpenApiOperation = z.infer<typeof operationSchema>;
export type OpenApiParameter = z.infer<typeof parameterSchema>;

const openApiMethods = ["get", "post", "patch", "delete", "put"] as const;
const methodLabels = {
  get: "GET",
  post: "POST",
  patch: "PATCH",
  delete: "DELETE",
  put: "PUT",
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
  throw new Error(`The relay operation ${operationId} is unavailable.`);
}

export function parametersOf(operationId: string): OpenApiParameter[] {
  const parameters = generatedOperation(operationId).operation.parameters ?? [];
  const parsed = z.array(parameterSchema).safeParse(parameters);
  if (!parsed.success) {
    throw new Error(
      `The relay operation ${operationId} has invalid parameters.`,
    );
  }
  return parsed.data;
}

export function requestSchemaOf(operationId: string): JsonSchema | undefined {
  const requestBody = generatedOperation(operationId).operation.requestBody;
  if (!requestBody) return undefined;
  const parsed = requestBodySchema.safeParse(requestBody);
  if (!parsed.success) {
    throw new Error(
      `The relay operation ${operationId} has an invalid request schema.`,
    );
  }
  return parsed.data.content["application/json"]?.schema;
}

/** The JSON schema of the first 2xx response, when one is declared. */
export function responseSchemaOf(operationId: string): JsonSchema | undefined {
  const responses = generatedOperation(operationId).operation.responses;
  for (const [status, response] of Object.entries(responses)) {
    if (!status.startsWith("2")) continue;
    return response.content?.["application/json"]?.schema;
  }
  return undefined;
}
