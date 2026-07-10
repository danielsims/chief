import type {
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from "convex/server";
import { v } from "convex/values";
import Stripe from "stripe";

import {
  httpAction,
  internalMutation,
  internalQuery,
  query,
  action,
} from "./_generated/server";
import { stripeSecretKey, stripeTrialDays, stripeWebhookSecret } from "./env";
import { requireOrganizationId } from "./lib/auth";

type BillingStatus =
  "trialing" | "active" | "past_due" | "canceled" | "incomplete";

const statusValidator = v.union(
  v.literal("trialing"),
  v.literal("active"),
  v.literal("past_due"),
  v.literal("canceled"),
  v.literal("incomplete"),
);

function fnRef<
  Type extends "query" | "mutation" | "action",
  Args extends Record<string, unknown>,
  Ret,
>(name: string): FunctionReference<Type, "public" | "internal", Args, Ret> {
  const ref: Record<string | symbol, string> = {};
  ref[Symbol.for("functionName")] = name;
  return ref as unknown as FunctionReference<
    Type,
    "public" | "internal",
    Args,
    Ret
  >;
}

const getByOrganizationIdRef = fnRef<
  "query",
  { organizationId: string },
  SubscriptionRecord | null
>("billing:getByOrganizationId");

const getByStripeCustomerIdRef = fnRef<
  "query",
  { stripeCustomerId: string },
  SubscriptionRecord | null
>("billing:getByStripeCustomerId");

const getByStripeSubscriptionIdRef = fnRef<
  "query",
  { stripeSubscriptionId: string },
  SubscriptionRecord | null
>("billing:getByStripeSubscriptionId");

const setStripeCustomerForOrgRef = fnRef<
  "mutation",
  { organizationId: string; stripeCustomerId: string },
  unknown
>("billing:setStripeCustomerForOrg");

const upsertSubscriptionFromStripeRef = fnRef<
  "mutation",
  UpsertSubscriptionArgs,
  unknown
>("billing:upsertSubscriptionFromStripe");

const claimStripeWebhookEventRef = fnRef<
  "mutation",
  { stripeEventId: string; type: string },
  { claimed: boolean }
>("billing:claimStripeWebhookEvent");

const hasStripeWebhookEventRef = fnRef<
  "query",
  { stripeEventId: string },
  boolean
>("billing:hasStripeWebhookEvent");

interface SubscriptionRecord {
  _id: string;
  organizationId: string;
  stripeCustomerId: string;
  stripeSubscriptionId?: string;
  status: BillingStatus;
  priceId?: string;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  trialEnd?: number;
  cancelAtPeriodEnd?: boolean;
  createdAt: number;
  updatedAt: number;
}

interface UpsertSubscriptionArgs extends Record<string, unknown> {
  organizationId: string;
  stripeCustomerId: string;
  stripeSubscriptionId?: string;
  status: BillingStatus;
  priceId?: string;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  trialEnd?: number;
  cancelAtPeriodEnd?: boolean;
}

interface ActionIdentity {
  organizationId: string;
  email?: string;
}

interface ActionContext {
  auth: {
    getUserIdentity: () => Promise<{
      organizationId?: unknown;
      email?: string;
    } | null>;
  };
  runQuery: <Query extends FunctionReference<"query", "public" | "internal">>(
    queryRef: Query,
    ...args: OptionalRestArgs<Query>
  ) => Promise<FunctionReturnType<Query>>;
  runMutation: <
    Mutation extends FunctionReference<"mutation", "public" | "internal">,
  >(
    mutationRef: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ) => Promise<FunctionReturnType<Mutation>>;
}

interface WebhookContext {
  runQuery: <Query extends FunctionReference<"query", "public" | "internal">>(
    queryRef: Query,
    ...args: OptionalRestArgs<Query>
  ) => Promise<FunctionReturnType<Query>>;
  runMutation: <
    Mutation extends FunctionReference<"mutation", "public" | "internal">,
  >(
    mutationRef: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ) => Promise<FunctionReturnType<Mutation>>;
}

function getStripe(secretKey = stripeSecretKey()): Stripe {
  return new Stripe(secretKey);
}

function validateRedirectUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Redirect URL must be a valid absolute URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Redirect URL must use http or https");
  }

  return parsed.toString();
}

function billingReturnUrl(status: string): string {
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (!siteUrl) throw new Error("Missing CONVEX_SITE_URL");
  return `${siteUrl}/billing/return?status=${status}`;
}

export const billingReturnPage = httpAction(async (_ctx, request) => {
  const status = new URL(request.url).searchParams.get("status");
  const success = status === "success";
  const heading = success ? "You're in." : "Checkout canceled.";
  const body = success
    ? "Your workspace is ready. Head back to Marketer to get started."
    : "Nothing was charged. Return to Marketer when you're ready.";
  const buttonLabel = success ? "Open Marketer" : "Return to Marketer";
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${heading} | Marketer</title>
  <style>
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      min-height: 100vh;
      background: #0c0c0c;
      color: #f5f5f5;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .brand {
      position: fixed;
      top: 32px;
      left: 32px;
      color: #f5f5f5;
      font-family: Georgia, serif;
      font-size: 24px;
      font-style: italic;
      line-height: 1;
    }
    main {
      display: flex;
      min-height: 100vh;
      align-items: center;
      justify-content: center;
      padding: 80px 28px;
    }
    .content { width: 100%; max-width: 360px; text-align: center; }
    h1 {
      margin: 0;
      font-family: Georgia, serif;
      font-size: 42px;
      font-weight: 400;
      letter-spacing: -0.025em;
      line-height: 1.05;
    }
    p {
      margin: 16px auto 0;
      color: #8c8c8c;
      font-size: 14px;
      line-height: 1.65;
    }
    a {
      display: inline-flex;
      width: 100%;
      height: 44px;
      margin-top: 40px;
      align-items: center;
      justify-content: center;
      background: #f5f5f5;
      color: #111;
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      transition: background 160ms ease;
    }
    a:hover { background: #dedede; }
    a:focus-visible { outline: 2px solid #f5f5f5; outline-offset: 3px; }
  </style>
</head>
<body>
  <span class="brand" aria-hidden="true">m.</span>
  <main>
    <div class="content">
      <h1>${heading}</h1>
      <p>${body}</p>
      <a href="marketer-desktop:///billing/success">${buttonLabel}</a>
    </div>
  </main>
</body>
</html>`,
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
});

async function requireActionIdentity(
  ctx: ActionContext,
): Promise<ActionIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthenticated");
  }

  const organizationId =
    typeof identity.organizationId === "string" ? identity.organizationId : "";
  if (!organizationId) {
    throw new Error("No active workspace. Sign out and back in.");
  }

  return { organizationId, email: identity.email };
}

async function ensureStripeCustomer(
  ctx: ActionContext,
  stripe: Stripe,
  identity: ActionIdentity,
): Promise<string> {
  const existing = await ctx.runQuery(getByOrganizationIdRef, {
    organizationId: identity.organizationId,
  });
  if (existing?.stripeCustomerId) {
    return existing.stripeCustomerId;
  }

  const customer = await stripe.customers.create(
    {
      email: identity.email,
      metadata: { organizationId: identity.organizationId },
    },
    { idempotencyKey: `marketer_org_customer_${identity.organizationId}` },
  );

  await ctx.runMutation(setStripeCustomerForOrgRef, {
    organizationId: identity.organizationId,
    stripeCustomerId: customer.id,
  });

  return customer.id;
}

function timestampFromStripe(
  value: number | null | undefined,
): number | undefined {
  return typeof value === "number" ? value * 1000 : undefined;
}

function mapStripeStatus(status: Stripe.Subscription.Status): BillingStatus {
  if (status === "trialing") return "trialing";
  if (status === "active") return "active";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (
    status === "canceled" ||
    status === "incomplete_expired" ||
    status === "paused"
  ) {
    return "canceled";
  }
  return "incomplete";
}

function subscriptionToUpsertArgs(
  subscription: Stripe.Subscription,
  fallbackOrganizationId: string,
): UpsertSubscriptionArgs {
  const firstItem = subscription.items.data[0];
  const customer =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  return {
    organizationId:
      subscription.metadata.organizationId || fallbackOrganizationId,
    stripeCustomerId: customer,
    stripeSubscriptionId: subscription.id,
    status: mapStripeStatus(subscription.status),
    priceId: firstItem?.price.id,
    currentPeriodStart: timestampFromStripe(firstItem?.current_period_start),
    currentPeriodEnd: timestampFromStripe(firstItem?.current_period_end),
    trialEnd: timestampFromStripe(subscription.trial_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription;
  if (!subscription) return null;
  return typeof subscription === "string" ? subscription : subscription.id;
}

async function resolveOrganizationId(
  ctx: WebhookContext,
  stripe: Stripe,
  params: {
    organizationId?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
  },
): Promise<string | null> {
  if (params.organizationId) return params.organizationId;

  if (params.stripeSubscriptionId) {
    const bySubscription = await ctx.runQuery(getByStripeSubscriptionIdRef, {
      stripeSubscriptionId: params.stripeSubscriptionId,
    });
    if (bySubscription) return bySubscription.organizationId;
  }

  if (params.stripeCustomerId) {
    const byCustomer = await ctx.runQuery(getByStripeCustomerIdRef, {
      stripeCustomerId: params.stripeCustomerId,
    });
    if (byCustomer) return byCustomer.organizationId;

    const customer = await stripe.customers.retrieve(params.stripeCustomerId);
    if (!customer.deleted && customer.metadata.organizationId) {
      return customer.metadata.organizationId;
    }
  }

  return null;
}

const PLAN_PRICES = {
  monthly: {
    lookupKey: "marketer_workspace_monthly_v1",
    unitAmount: 4900,
    interval: "month" as const,
  },
  annual: {
    lookupKey: "marketer_workspace_annual_v1",
    unitAmount: 52900,
    interval: "year" as const,
  },
};

/**
 * Finds the plan's price by lookup key, creating the product and price in
 * Stripe on first use. Pricing lives in Stripe, not in env vars.
 */
async function ensurePlanPrice(
  stripe: Stripe,
  plan: "monthly" | "annual",
): Promise<string> {
  const spec = PLAN_PRICES[plan];
  const existing = await stripe.prices.list({
    lookup_keys: [spec.lookupKey],
    limit: 1,
  });
  if (existing.data[0]) return existing.data[0].id;

  const products = await stripe.products.search({
    query: 'metadata["marketerProduct"]:"workspace"',
    limit: 1,
  });
  const product =
    products.data[0] ??
    (await stripe.products.create({
      name: "Marketer workspace",
      metadata: { marketerProduct: "workspace" },
    }));

  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: spec.unitAmount,
    recurring: { interval: spec.interval },
    lookup_key: spec.lookupKey,
  });
  return price.id;
}

export const createCheckoutSession = action({
  args: {
    plan: v.union(v.literal("monthly"), v.literal("annual")),
    successUrl: v.optional(v.string()),
    cancelUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const identity = await requireActionIdentity(ctx);
    const stripe = getStripe(stripeSecretKey());
    const customerId = await ensureStripeCustomer(ctx, stripe, identity);
    const priceId = await ensurePlanPrice(stripe, args.plan);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_collection: "always",
      client_reference_id: identity.organizationId,
      metadata: {
        organizationId: identity.organizationId,
        plan: args.plan,
      },
      subscription_data: {
        trial_period_days: stripeTrialDays(),
        metadata: {
          organizationId: identity.organizationId,
          plan: args.plan,
        },
      },
      success_url: validateRedirectUrl(
        args.successUrl ?? billingReturnUrl("success"),
      ),
      cancel_url: validateRedirectUrl(
        args.cancelUrl ?? billingReturnUrl("canceled"),
      ),
    });

    if (!session.url) {
      throw new Error("Stripe did not return a Checkout URL");
    }

    return { url: session.url };
  },
});

export const createPortalSession = action({
  args: {
    returnUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const identity = await requireActionIdentity(ctx);
    const stripe = getStripe();
    const customerId = await ensureStripeCustomer(ctx, stripe, identity);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: validateRedirectUrl(
        args.returnUrl ?? billingReturnUrl("portal"),
      ),
    });

    return { url: session.url };
  },
});

export const getSubscription = query({
  args: {},
  handler: async (ctx) => {
    const organizationId = await requireOrganizationId(ctx);
    return ctx.db
      .query("subscription")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organizationId),
      )
      .unique();
  },
});

export const getByOrganizationId = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("subscription")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .unique();
  },
});

export const getByStripeCustomerId = internalQuery({
  args: {
    stripeCustomerId: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("subscription")
      .withIndex("by_stripeCustomerId", (q) =>
        q.eq("stripeCustomerId", args.stripeCustomerId),
      )
      .first();
  },
});

export const getByStripeSubscriptionId = internalQuery({
  args: {
    stripeSubscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("subscription")
      .withIndex("by_stripeSubscriptionId", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId),
      )
      .first();
  },
});

export const setStripeCustomerForOrg = internalMutation({
  args: {
    organizationId: v.string(),
    stripeCustomerId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("subscription")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        stripeCustomerId: args.stripeCustomerId,
        updatedAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("subscription", {
      organizationId: args.organizationId,
      stripeCustomerId: args.stripeCustomerId,
      status: "incomplete",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const upsertSubscriptionFromStripe = internalMutation({
  args: {
    organizationId: v.string(),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.optional(v.string()),
    status: statusValidator,
    priceId: v.optional(v.string()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    trialEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existingBySubscription = args.stripeSubscriptionId
      ? await ctx.db
          .query("subscription")
          .withIndex("by_stripeSubscriptionId", (q) =>
            q.eq("stripeSubscriptionId", args.stripeSubscriptionId),
          )
          .first()
      : null;
    const existing =
      existingBySubscription ??
      (await ctx.db
        .query("subscription")
        .withIndex("by_organization", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .unique());

    const patch = {
      organizationId: args.organizationId,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      status: args.status,
      priceId: args.priceId,
      currentPeriodStart: args.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd,
      trialEnd: args.trialEnd,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return ctx.db.insert("subscription", {
      ...patch,
      createdAt: now,
    });
  },
});

export const claimStripeWebhookEvent = internalMutation({
  args: {
    stripeEventId: v.string(),
    type: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("stripeWebhookEvent")
      .withIndex("by_stripeEventId", (q) =>
        q.eq("stripeEventId", args.stripeEventId),
      )
      .first();

    if (existing) return { claimed: false as const };

    await ctx.db.insert("stripeWebhookEvent", {
      stripeEventId: args.stripeEventId,
      type: args.type,
      processedAt: Date.now(),
    });
    return { claimed: true as const };
  },
});

export const hasStripeWebhookEvent = internalQuery({
  args: {
    stripeEventId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("stripeWebhookEvent")
      .withIndex("by_stripeEventId", (q) =>
        q.eq("stripeEventId", args.stripeEventId),
      )
      .first();
    return existing !== null;
  },
});

export const stripeWebhook = httpAction(async (ctx, request) => {
  const stripe = getStripe();
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      stripeWebhookSecret(),
    );
  } catch (error) {
    console.error("[stripe-webhook] Signature verification failed", error);
    return new Response("Webhook signature verification failed", {
      status: 400,
    });
  }

  const alreadyProcessed = await ctx.runQuery(hasStripeWebhookEventRef, {
    stripeEventId: event.id,
  });
  if (alreadyProcessed) {
    return new Response("OK", { status: 200 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(ctx, stripe, event.data.object);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(ctx, stripe, event.data.object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(ctx, stripe, event.data.object);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(ctx, stripe, event.data.object);
        break;
      default:
        console.log(`[stripe-webhook] Unhandled event type: ${event.type}`);
    }
  } catch (error) {
    console.error(`[stripe-webhook] Error handling ${event.type}`, error);
    // Stripe retries non-2xx deliveries. Do not mark the event processed until
    // every handler has succeeded, otherwise a transient Stripe/Convex failure
    // can permanently strand a paid workspace at onboarding.
    return new Response("Webhook processing failed", { status: 500 });
  }

  await ctx.runMutation(claimStripeWebhookEventRef, {
    stripeEventId: event.id,
    type: event.type,
  });

  return new Response("OK", { status: 200 });
});

async function handleCheckoutCompleted(
  ctx: WebhookContext,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
) {
  const stripeCustomerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
  if (!stripeCustomerId) {
    throw new Error(
      "checkout.session.completed is missing its Stripe customer",
    );
  }

  const organizationId = await resolveOrganizationId(ctx, stripe, {
    organizationId:
      session.client_reference_id ?? session.metadata?.organizationId,
    stripeCustomerId,
    stripeSubscriptionId:
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id,
  });
  if (!organizationId) {
    throw new Error(
      `Could not resolve the workspace for Stripe customer ${stripeCustomerId}`,
    );
  }

  await ctx.runMutation(setStripeCustomerForOrgRef, {
    organizationId,
    stripeCustomerId,
  });

  const stripeSubscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  if (!stripeSubscriptionId) {
    throw new Error(
      `Checkout session ${session.id} completed without a subscription`,
    );
  }

  const subscription =
    await stripe.subscriptions.retrieve(stripeSubscriptionId);
  await ctx.runMutation(
    upsertSubscriptionFromStripeRef,
    subscriptionToUpsertArgs(subscription, organizationId),
  );
}

async function handleSubscriptionUpdated(
  ctx: WebhookContext,
  stripe: Stripe,
  subscription: Stripe.Subscription,
) {
  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const organizationId = await resolveOrganizationId(ctx, stripe, {
    organizationId: subscription.metadata.organizationId,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
  });
  if (!organizationId) {
    throw new Error(
      `Could not resolve the workspace for subscription ${subscription.id}`,
    );
  }

  await ctx.runMutation(
    upsertSubscriptionFromStripeRef,
    subscriptionToUpsertArgs(subscription, organizationId),
  );
}

async function handleSubscriptionDeleted(
  ctx: WebhookContext,
  stripe: Stripe,
  subscription: Stripe.Subscription,
) {
  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const organizationId = await resolveOrganizationId(ctx, stripe, {
    organizationId: subscription.metadata.organizationId,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
  });
  if (!organizationId) {
    throw new Error(
      `Could not resolve the workspace for subscription ${subscription.id}`,
    );
  }

  await ctx.runMutation(upsertSubscriptionFromStripeRef, {
    ...subscriptionToUpsertArgs(subscription, organizationId),
    status: "canceled",
  });
}

async function handleInvoicePaymentFailed(
  ctx: WebhookContext,
  stripe: Stripe,
  invoice: Stripe.Invoice,
) {
  const stripeCustomerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id;
  const stripeSubscriptionId = invoiceSubscriptionId(invoice);

  const organizationId = await resolveOrganizationId(ctx, stripe, {
    organizationId: undefined,
    stripeCustomerId,
    stripeSubscriptionId,
  });
  if (!organizationId || !stripeCustomerId) {
    throw new Error(
      `Could not resolve the workspace for failed invoice ${invoice.id}`,
    );
  }

  if (stripeSubscriptionId) {
    const subscription =
      await stripe.subscriptions.retrieve(stripeSubscriptionId);
    await ctx.runMutation(upsertSubscriptionFromStripeRef, {
      ...subscriptionToUpsertArgs(subscription, organizationId),
      status: "past_due",
    });
    return;
  }

  await ctx.runMutation(upsertSubscriptionFromStripeRef, {
    organizationId,
    stripeCustomerId,
    status: "past_due",
  });
}
