import type { GoogleApiService, GoogleOAuthSetupRecipe } from "./types.js";

export const GOOGLE_OAUTH_AUTHORIZATION_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const googleAnalyticsRecipe: GoogleOAuthSetupRecipe = {
  id: "google-analytics",
  name: "Google Analytics",
  services: [
    {
      name: "Google Analytics Data API",
      service: "analyticsdata.googleapis.com",
    },
    {
      name: "Google Analytics Admin API",
      service: "analyticsadmin.googleapis.com",
    },
  ],
};

export const gmailRecipe: GoogleOAuthSetupRecipe = {
  id: "gmail",
  name: "Gmail",
  services: [{ name: "Gmail API", service: "gmail.googleapis.com" }],
};

function projectUrl(url: string, projectId?: string): string {
  if (!projectId) return url;
  const result = new URL(url);
  result.searchParams.set("project", projectId);
  return result.toString();
}

export function googleApiLibraryUrl(
  service: GoogleApiService,
  projectId?: string,
): string {
  return projectUrl(
    `https://console.cloud.google.com/apis/library/${service.service}`,
    projectId,
  );
}

export function googleAccountChooserUrl(continueUrl: string): string {
  const params = new URLSearchParams({
    service: "cloudconsole",
    continue: continueUrl,
  });
  return `https://accounts.google.com/AccountChooser?${params.toString()}`;
}

export const googleAuthPlatformOverviewUrl = (projectId?: string) =>
  projectUrl("https://console.cloud.google.com/auth/overview", projectId);
export const googleAuthPlatformAudienceUrl = (projectId?: string) =>
  projectUrl("https://console.cloud.google.com/auth/audience", projectId);
export const googleOAuthClientCreateUrl = (projectId?: string) =>
  projectUrl("https://console.cloud.google.com/auth/clients/create", projectId);
