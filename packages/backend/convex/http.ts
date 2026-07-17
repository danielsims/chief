import { httpRouter } from "convex/server";

import {
  runAnalyticsReport as agentToolAnalyticsReport,
  capabilityIdentity as agentToolCapabilityIdentity,
  markIntegrationConnected as agentToolMarkIntegrationConnected,
  presentChart as agentToolPresentChart,
  openApiSpec as agentToolsOpenApi,
  listSources as agentToolSources,
} from "./agentTools";
import { authComponent, createAuth } from "./auth";
import { billingReturnPage, stripeWebhook } from "./billing";
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
  path: "/agent-tools/whoami",
  method: "GET",
  handler: agentToolCapabilityIdentity,
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

http.route({
  path: "/agent-tools/integrations/connected",
  method: "POST",
  handler: agentToolMarkIntegrationConnected,
});

http.route({
  path: "/agent-tools/ui/chart",
  method: "POST",
  handler: agentToolPresentChart,
});

export default http;
