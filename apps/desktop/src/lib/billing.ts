import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "@marketer/backend/convex/_generated/api";
import { convex } from "./convex";

export type BillingPlan = "monthly" | "annual";

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
    // No redirect URLs from here: the desktop origin is tauri://, which
    // Stripe rejects. The backend defaults to its own hosted return page.
    const result = (await convex.action(
      createCheckoutSession as never,
      { plan } as never,
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
