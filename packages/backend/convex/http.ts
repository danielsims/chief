import { httpRouter } from "convex/server";

import { authComponent, createAuth } from "./auth";
import { stripeWebhook } from "./billing";
import { oauthCallback as googleAnalyticsOauthCallback } from "./googleAnalytics";

const http = httpRouter();

// Register Better Auth routes
authComponent.registerRoutes(http, createAuth);

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: stripeWebhook,
});

http.route({
  path: "/google-analytics/callback",
  method: "GET",
  handler: googleAnalyticsOauthCallback,
});

export default http;
