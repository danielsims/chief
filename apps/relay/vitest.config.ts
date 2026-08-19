import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          BOOTSTRAP_TOKEN_SHA256:
            "f28e240d9b814940eed7721345997664c751b56eaeae8d7cefa304a1fda1ccda",
          RELAY_PUBLIC_URL: "https://relay.test",
        },
      },
    }),
  ],
});
