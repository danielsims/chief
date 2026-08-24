import { z } from "zod";

const configSchema = z
  .object({
    EXECUTOR_AUTH_ISSUER: z.url(),
    EXECUTOR_AUTH_AUDIENCE: z.string().trim().min(1),
    EXECUTOR_AUTH_JWKS_URL: z.url(),
    EXECUTOR_ROOT: z.string().trim().min(1).default("/workspace"),
    EXECUTOR_MAX_OUTPUT_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(50_000_000)
      .default(2_000_000),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  })
  .strict();

export type ExecutorConfig = z.infer<typeof configSchema>;

export function readConfig(environment: NodeJS.ProcessEnv): ExecutorConfig {
  return configSchema.parse(environment);
}
