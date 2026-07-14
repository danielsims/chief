import { createEnv } from "@t3-oss/env-core";
import { z } from "zod/v4";

const skipValidation =
  Boolean(process.env.CI) || process.env.npm_lifecycle_event === "lint";

export function convexEnv() {
  return createEnv({
    server: {
      AUTH_SECRET: z.string().min(1),
      AUTH_GOOGLE_ID: z.string().min(1),
      AUTH_GOOGLE_SECRET: z.string().min(1),
      BASE_URL: z.url(),
    },
    runtimeEnv: process.env,
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

export function googleAnalyticsEnv() {
  return createEnv({
    server: {
      AUTH_GOOGLE_ID: z.string().min(1).optional(),
      AUTH_GOOGLE_SECRET: z.string().min(1).optional(),
      CONVEX_SITE_URL: z.url().optional(),
      GOOGLE_ANALYTICS_CLIENT_ID: z.string().min(1).optional(),
      GOOGLE_ANALYTICS_CLIENT_SECRET: z.string().min(1).optional(),
      GOOGLE_ANALYTICS_REDIRECT_URI: z.url().optional(),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
    skipValidation,
  });
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
