import { googleAnalyticsRecipe } from "@chief/google-oauth-connector";

import type { IntegrationSetupProgress } from "./types.js";

export function googleAnalyticsBrowserProgress(
  rawUrl: string,
): IntegrationSetupProgress | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }
  if (url.hostname !== "console.cloud.google.com") return;
  const service = googleAnalyticsRecipe.services.find((candidate) =>
    url.pathname.includes(`/apis/library/${candidate.service}`),
  );
  if (service) {
    return {
      recipeId: "google-analytics",
      phase: "enable-api",
      service: service.name,
      instruction: `Chief is enabling ${service.name}…`,
      status: "active",
    };
  }
  if (url.pathname.startsWith("/auth/clients")) {
    return {
      recipeId: "google-analytics",
      phase: "create-client",
      instruction: "Chief is creating the Desktop OAuth client…",
      status: "active",
    };
  }
  if (url.pathname.startsWith("/auth/")) {
    return {
      recipeId: "google-analytics",
      phase: "auth-platform",
      instruction: "Chief is configuring Google Auth Platform…",
      status: "active",
    };
  }
}
