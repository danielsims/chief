import { createEnv } from "@t3-oss/env-core";
import { z } from "zod/v4";

const skipValidation =
  Boolean(process.env.CI) || process.env.npm_lifecycle_event === "lint";

const authEnvironmentKeys = [
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "BASE_URL",
] as const;

// Convex analyzes every module before deployment without exposing deployment
// environment variables. Better Auth constructs its adapter during that pass,
// so give T3 Env valid, inert values only when the entire auth environment is
// absent. A partially configured runtime still fails strict validation.
const isConvexAnalysis = authEnvironmentKeys.every((key) => !process.env[key]);

export function convexEnv() {
  return createEnv({
    server: {
      AUTH_SECRET: z.string().min(1),
      AUTH_GOOGLE_ID: z.string().min(1),
      AUTH_GOOGLE_SECRET: z.string().min(1),
      BASE_URL: z.url(),
    },
    runtimeEnv: {
      AUTH_SECRET:
        process.env.AUTH_SECRET ??
        (isConvexAnalysis ? "convex-analysis-only" : undefined),
      AUTH_GOOGLE_ID:
        process.env.AUTH_GOOGLE_ID ??
        (isConvexAnalysis ? "convex-analysis-only" : undefined),
      AUTH_GOOGLE_SECRET:
        process.env.AUTH_GOOGLE_SECRET ??
        (isConvexAnalysis ? "convex-analysis-only" : undefined),
      BASE_URL:
        process.env.BASE_URL ??
        (isConvexAnalysis ? "https://analysis.invalid" : undefined),
    },
    emptyStringAsUndefined: true,
    skipValidation,
  });
}

function billingEnv() {
  return createEnv({
    server: {
      STRIPE_SECRET_KEY: z.string().min(1),
      STRIPE_WEBHOOK_SECRET: z.string().min(1),
      STRIPE_TRIAL_DAYS: z.coerce.number().int().positive().default(14),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
    skipValidation,
  });
}

export function convexSiteUrl(): string {
  return createEnv({
    server: { CONVEX_SITE_URL: z.url() },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
    skipValidation,
  }).CONVEX_SITE_URL;
}

export function stripeSecretKey(): string {
  return billingEnv().STRIPE_SECRET_KEY;
}

export function stripeWebhookSecret(): string {
  return billingEnv().STRIPE_WEBHOOK_SECRET;
}

export function stripeTrialDays(): number {
  return billingEnv().STRIPE_TRIAL_DAYS;
}
