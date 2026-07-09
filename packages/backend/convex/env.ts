/**
 * Convex environment variables.
 * These are set in the Convex dashboard and accessed at runtime.
 *
 * Note: Convex functions run in a sandboxed environment, so we use
 * a simple validation pattern instead of @t3-oss/env-core.
 *
 * During Convex's bundling/analysis phase, environment variables are not
 * available. We detect this by checking if ALL required vars are missing
 * and return empty placeholders. Actual validation happens at runtime.
 */

interface ConvexEnv {
  AUTH_SECRET: string;
  AUTH_GOOGLE_ID: string;
  AUTH_GOOGLE_SECRET: string;
  BASE_URL: string;
}

const REQUIRED_VARS = [
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "BASE_URL",
] as const;

function isBundlingPhase(): boolean {
  // During bundling, none of the Convex env vars will be present
  // At runtime, they should all be present (set via Convex dashboard)
  return REQUIRED_VARS.every((name) => !process.env[name]);
}

function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function validateUrl(value: string, name: string): string {
  try {
    new URL(value);
    return value;
  } catch {
    throw new Error(`Invalid URL for ${name}: ${value}`);
  }
}

let cachedEnv: ConvexEnv | null = null;

export function convexEnv(): ConvexEnv {
  // Skip validation during CI/lint
  if (process.env.CI || process.env.npm_lifecycle_event === "lint") {
    return {
      AUTH_SECRET: process.env.AUTH_SECRET ?? "",
      AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID ?? "",
      AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET ?? "",
      BASE_URL: process.env.BASE_URL ?? "",
    };
  }

  // During Convex bundling phase, env vars aren't available yet
  // Return empty placeholders - actual validation happens at runtime
  if (isBundlingPhase()) {
    return {
      AUTH_SECRET: "",
      AUTH_GOOGLE_ID: "",
      AUTH_GOOGLE_SECRET: "",
      BASE_URL: "",
    };
  }

  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = {
    AUTH_SECRET: getEnvVar("AUTH_SECRET"),
    AUTH_GOOGLE_ID: getEnvVar("AUTH_GOOGLE_ID"),
    AUTH_GOOGLE_SECRET: getEnvVar("AUTH_GOOGLE_SECRET"),
    BASE_URL: validateUrl(getEnvVar("BASE_URL"), "BASE_URL"),
  };

  return cachedEnv;
}

function parseTrialDays(value: string | undefined): number {
  if (!value) return 14;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("Invalid STRIPE_TRIAL_DAYS: expected a positive integer");
  }
  return parsed;
}

export function stripeSecretKey(): string {
  return getEnvVar("STRIPE_SECRET_KEY");
}

export function stripeWebhookSecret(): string {
  return getEnvVar("STRIPE_WEBHOOK_SECRET");
}

export function stripeTrialDays(): number {
  return parseTrialDays(process.env.STRIPE_TRIAL_DAYS);
}
