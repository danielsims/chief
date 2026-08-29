import { authorizeGoogleAnalyticsTool } from "./authorize-google-analytics.js";
import { captureGeneratedCredentialTool } from "./capture-generated-credential.js";
import { captureGoogleOAuthClientTool } from "./capture-google-oauth-client.js";
import { completeGoogleAnalyticsTool } from "./complete-google-analytics.js";
import { openIntegrationHandoffTool } from "./open-integration-handoff.js";
import { openProviderPageTool } from "./open-provider-page.js";
import { provisionGoogleOAuthClientTool } from "./provision-google-oauth-client.js";
import { selectGoogleAnalyticsPropertyTool } from "./select-google-analytics-property.js";

export const integrationsToolkit = [
  authorizeGoogleAnalyticsTool,
  completeGoogleAnalyticsTool,
  selectGoogleAnalyticsPropertyTool,
  provisionGoogleOAuthClientTool,
  captureGoogleOAuthClientTool,
  openIntegrationHandoffTool,
  captureGeneratedCredentialTool,
  openProviderPageTool,
] as const;
