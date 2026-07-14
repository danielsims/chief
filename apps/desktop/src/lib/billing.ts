import { openUrl } from "@tauri-apps/plugin-opener";

import { api } from "@chief/backend/convex/_generated/api";

import { AUTH_BASE_URL } from "./auth/better-auth-client";
import { convex } from "./convex";

export type BillingPlan = "monthly" | "annual";

export type BillingStatus =
  "trialing" | "active" | "past_due" | "canceled" | "incomplete";

export function hasWorkspaceAccess(
  subscription: { status: BillingStatus } | null | undefined,
): boolean {
  return (
    subscription?.status === "trialing" || subscription?.status === "active"
  );
}

export type CheckoutResult =
  | { status: "opened" }
  | { status: "unavailable" }
  | { status: "error"; message: string };

export async function openWorkspaceCheckout(
  plan: BillingPlan,
): Promise<CheckoutResult> {
  const billingApi = (
    api as unknown as {
      billing?: {
        createCheckoutSession?: unknown;
      };
    }
  ).billing;
  const createCheckoutSession = billingApi?.createCheckoutSession;

  if (!createCheckoutSession) {
    return { status: "unavailable" };
  }

  try {
    // Return through the web app's billing page (the desktop's own origin is
    // tauri://, which Stripe rejects). It celebrates, then deep-links back.
    const result = (await convex.action(
      createCheckoutSession as never,
      {
        plan,
        successUrl: `${AUTH_BASE_URL}/billing/return?status=success`,
        cancelUrl: `${AUTH_BASE_URL}/billing/return?status=canceled`,
      } as never,
    )) as { url?: string } | null;

    if (!result?.url) {
      return { status: "error", message: "Checkout did not return a URL." };
    }

    await openUrl(result.url);
    return { status: "opened" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
