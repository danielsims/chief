import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll } from "vitest";
import { z } from "zod";

const migrationBindingsSchema = z.object({
  AUTH_DB: z.custom<D1Database>(),
  TEST_MIGRATIONS: z.array(
    z.object({ name: z.string(), queries: z.string().array() }),
  ),
});

beforeAll(async () => {
  const bindings = migrationBindingsSchema.parse(env);
  await applyD1Migrations(bindings.AUTH_DB, bindings.TEST_MIGRATIONS);
});
