import { z } from "zod";

import {
  agentIdSchema,
  isoDateTimeSchema,
  workspaceIdSchema,
} from "./identifiers";

export const executionIdSchema = z.uuid().brand<"ExecutionId">();

export const executionCapabilitySchema = z.enum([
  "filesystem:read",
  "filesystem:write",
  "git:read",
  "git:write",
  "process:exec",
  "browser:use",
  "network:egress",
]);

export const executionResourcesSchema = z
  .object({
    cpuMillis: z.int().min(50).max(32_000),
    memoryMib: z.int().min(128).max(65_536),
    diskMib: z.int().min(256).max(262_144),
    wallTimeSeconds: z.int().min(5).max(86_400),
  })
  .strict();

export const executionNetworkPolicySchema = z
  .object({
    mode: z.enum(["deny", "allow-list"]),
    allowedHosts: z.array(z.string().trim().min(1).max(253)).max(256),
  })
  .strict();

export const executionLeaseSchema = z
  .object({
    id: executionIdSchema,
    workspaceId: workspaceIdSchema,
    agentId: agentIdSchema,
    placementEpoch: z.int().positive(),
    capabilities: z.array(executionCapabilitySchema).min(1).max(16),
    resources: executionResourcesSchema,
    network: executionNetworkPolicySchema,
    issuedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((lease, context) => {
    if (new Date(lease.expiresAt) <= new Date(lease.issuedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Execution lease must expire after it is issued.",
      });
    }
    if (new Set(lease.capabilities).size !== lease.capabilities.length) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: "Execution capabilities must be unique.",
      });
    }
  });

export const relativeExecutionPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine((value) => !value.startsWith("/"), "Path must be relative.")
  .refine(
    (value) => !value.split(/[\\/]/u).includes(".."),
    "Path cannot leave the execution root.",
  );

export const execRequestSchema = z
  .object({
    argv: z.array(z.string().max(32_768)).min(1).max(256),
    cwd: relativeExecutionPathSchema.default("."),
    timeoutMillis: z.int().min(100).max(3_600_000),
    stdin: z.string().max(1_000_000).optional(),
  })
  .strict();

export const execResultSchema = z
  .object({
    exitCode: z.int().nullable(),
    signal: z.string().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    truncated: z.boolean(),
    durationMillis: z.int().nonnegative(),
  })
  .strict();

export const readExecutionFileSchema = z
  .object({
    path: relativeExecutionPathSchema,
    maxBytes: z.int().min(1).max(10_000_000).default(1_000_000),
  })
  .strict();

export const writeExecutionFileSchema = z
  .object({
    path: relativeExecutionPathSchema,
    contentBase64: z.string().max(14_000_000),
    createParents: z.boolean().default(false),
  })
  .strict();

export type ExecutionId = z.infer<typeof executionIdSchema>;
export type ExecutionCapability = z.infer<typeof executionCapabilitySchema>;
export type ExecutionLease = z.infer<typeof executionLeaseSchema>;
export type ExecRequest = z.infer<typeof execRequestSchema>;
export type ExecResult = z.infer<typeof execResultSchema>;
