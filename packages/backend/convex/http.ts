import { httpRouter } from "convex/server";

import {
  listAnalyticsDatasets as agentToolAnalyticsDatasets,
  capabilityIdentity as agentToolCapabilityIdentity,
  listCloudRecords as agentToolCloudRecords,
  dismissCloudActionHttp as agentToolDismissCloudAction,
  markIntegrationConnected as agentToolMarkIntegrationConnected,
  presentChart as agentToolPresentChart,
  saveAnalyticsDatasetHttp as agentToolSaveAnalyticsDataset,
  saveCloudActionHttp as agentToolSaveCloudAction,
  saveCloudFileHttp as agentToolSaveCloudFile,
  saveCloudProspectHttp as agentToolSaveCloudProspect,
  openApiSpec as agentToolsOpenApi,
  listSources as agentToolSources,
} from "./agentTools";
import { authComponent, createAuth } from "./auth";
import { billingReturnPage, stripeWebhook } from "./billing";

const http = httpRouter();

// Register Better Auth routes
authComponent.registerRoutes(http, createAuth);

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: stripeWebhook,
});

http.route({
  path: "/agent-tools/records",
  method: "GET",
  handler: agentToolCloudRecords,
});

http.route({
  path: "/agent-tools/prospects",
  method: "POST",
  handler: agentToolSaveCloudProspect,
});

http.route({
  path: "/agent-tools/files",
  method: "POST",
  handler: agentToolSaveCloudFile,
});

http.route({
  path: "/agent-tools/actions",
  method: "POST",
  handler: agentToolSaveCloudAction,
});

http.route({
  path: "/agent-tools/actions/dismiss",
  method: "POST",
  handler: agentToolDismissCloudAction,
});

http.route({
  path: "/billing/return",
  method: "GET",
  handler: billingReturnPage,
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
  path: "/agent-tools/integrations/connected",
  method: "POST",
  handler: agentToolMarkIntegrationConnected,
});

http.route({
  path: "/agent-tools/analytics/datasets",
  method: "GET",
  handler: agentToolAnalyticsDatasets,
});

http.route({
  path: "/agent-tools/analytics/datasets",
  method: "POST",
  handler: agentToolSaveAnalyticsDataset,
});

http.route({
  path: "/agent-tools/ui/chart",
  method: "POST",
  handler: agentToolPresentChart,
});

export default http;
