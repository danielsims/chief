import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        new URL("../../packages/auth/migrations", import.meta.url).pathname,
      );
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            BOOTSTRAP_TOKEN_SHA256:
              "f28e240d9b814940eed7721345997664c751b56eaeae8d7cefa304a1fda1ccda",
            RELAY_PUBLIC_URL: "https://relay.test",
            ACCOUNT_IDENTITY_MODE: "key-native",
            HOSTED_CELL_ENABLED: "false",
            HOSTED_AGENT_COMPACTION_RATIO: "0.75",
            OPENCODE_API_KEY: process.env.OPENCODE_API_KEY ?? "test",
            AUTH_BASE_URL: "https://relay.test",
            AUTH_UI_ORIGIN: "https://app.test",
            AUTH_GOOGLE_REDIRECT_URI:
              "https://app.test/api/auth/callback/google",
            BETTER_AUTH_SECRET:
              "test-only-relay-auth-secret-with-at-least-thirty-two-characters",
            TEST_MIGRATIONS: migrations,
          },
        },
      };
    }),
  ],
  test: { setupFiles: ["./test/apply-migrations.ts"] },
});
