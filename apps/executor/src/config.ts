import { readFileSync } from "node:fs";
import { z } from "zod";

const commonConfigSchema = z.object({
  EXECUTOR_ROOT: z.string().trim().min(1).default("/computers"),
  EXECUTOR_MAX_OUTPUT_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(50_000_000)
    .default(2_000_000),
  COMPUTER_PUBLIC_URL: z.url(),
  COMPUTER_BROWSER_ENCRYPTION_KEY: z.string().min(32),
  COMPUTER_BROWSER_STREAM_SECRET: z.string().min(32),
  CHROMIUM_EXECUTABLE_PATH: z.string().trim().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
});

const sharedSecretAuthSchema = z.object({
  kind: z.literal("shared-secret"),
  issuer: z.url(),
  audience: z.string().trim().min(1),
  secret: z.string().min(32),
});

const jwksAuthSchema = z.object({
  kind: z.literal("jwks"),
  issuer: z.url(),
  audience: z.string().trim().min(1),
  jwksUrl: z.url(),
});

export type ExecutorConfig = z.infer<typeof commonConfigSchema> & {
  auth: z.infer<typeof sharedSecretAuthSchema> | z.infer<typeof jwksAuthSchema>;
};

export function readConfig(environment: NodeJS.ProcessEnv): ExecutorConfig {
  const browserEncryptionKey = readSecret(
    environment.COMPUTER_BROWSER_ENCRYPTION_KEY,
    environment.COMPUTER_BROWSER_ENCRYPTION_KEY_FILE,
  );
  const browserStreamSecret = readSecret(
    environment.COMPUTER_BROWSER_STREAM_SECRET,
    environment.COMPUTER_BROWSER_STREAM_SECRET_FILE,
  );
  const common = commonConfigSchema.parse({
    EXECUTOR_ROOT: environment.EXECUTOR_ROOT,
    EXECUTOR_MAX_OUTPUT_BYTES: environment.EXECUTOR_MAX_OUTPUT_BYTES,
    COMPUTER_PUBLIC_URL: environment.COMPUTER_PUBLIC_URL,
    COMPUTER_BROWSER_ENCRYPTION_KEY: browserEncryptionKey,
    COMPUTER_BROWSER_STREAM_SECRET: browserStreamSecret,
    CHROMIUM_EXECUTABLE_PATH: environment.CHROMIUM_EXECUTABLE_PATH,
    PORT: environment.PORT,
  });
  const issuer = environment.EXECUTOR_AUTH_ISSUER;
  const audience = environment.EXECUTOR_AUTH_AUDIENCE;
  const secret = readSecret(
    environment.COMPUTER_AUTH_SECRET,
    environment.COMPUTER_AUTH_SECRET_FILE,
  );
  const auth = secret
    ? sharedSecretAuthSchema.parse({
        kind: "shared-secret",
        issuer,
        audience,
        secret,
      })
    : jwksAuthSchema.parse({
        kind: "jwks",
        issuer,
        audience,
        jwksUrl: environment.EXECUTOR_AUTH_JWKS_URL,
      });
  return { ...common, auth };
}

function readSecret(value: string | undefined, file: string | undefined) {
  if (value?.trim()) return value.trim();
  return file ? readFileSync(file, "utf8").trim() : undefined;
}
