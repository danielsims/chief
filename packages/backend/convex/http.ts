import { httpRouter } from "convex/server";

import { authComponent, createAuth } from "./auth";
import { billingReturnPage, stripeWebhook } from "./billing";
import { oauthCallback as googleAnalyticsOauthCallback } from "./googleAnalytics";
import {
  listSources as agentToolSources,
  openApiSpec as agentToolsOpenApi,
  runAnalyticsReport as agentToolAnalyticsReport,
} from "./agentTools";

const http = httpRouter();

// Register Better Auth routes
authComponent.registerRoutes(http, createAuth);

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: stripeWebhook,
});

http.route({
  path: "/billing/return",
  method: "GET",
  handler: billingReturnPage,
});

http.route({
  path: "/google-analytics/callback",
  method: "GET",
  handler: googleAnalyticsOauthCallback,
});

http.route({
  path: "/agent-tools/openapi.json",
  method: "GET",
  handler: agentToolsOpenApi,
});

http.route({
  path: "/agent-tools/sources",
  method: "GET",
  handler: agentToolSources,
});

http.route({
  path: "/agent-tools/analytics/report",
  method: "POST",
  handler: agentToolAnalyticsReport,
});

export default http;
