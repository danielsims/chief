import type {
  GoogleOAuthSetupPlanStep,
  GoogleOAuthSetupProgress,
  GoogleOAuthSetupRecipe,
} from "./types.js";

export function googleOAuthSetupPlan(
  recipe: GoogleOAuthSetupRecipe,
): readonly GoogleOAuthSetupPlanStep[] {
  return [
    {
      id: "authenticated-session",
      label: "Sign in to Google",
      phase: "authenticated-session",
    },
    {
      id: "project",
      label: "Use the Google Cloud project",
      phase: "project",
    },
    ...recipe.services.map((service) => ({
      id: `enable-api:${service.service}`,
      label: `Enable ${service.name}`,
      phase: "enable-api" as const,
      service: service.name,
    })),
    {
      id: "auth-platform",
      label: "Configure Google Auth Platform",
      phase: "auth-platform",
    },
    {
      id: "create-client",
      label: "Create the Desktop OAuth client",
      phase: "create-client",
    },
    {
      id: "save-client",
      label: "Save the credentials in Chief",
      phase: "save-client",
    },
    {
      id: "authorize",
      label: `Authorize ${recipe.name}`,
      phase: "authorize",
    },
    {
      id: "verify",
      label: `Verify the ${recipe.name} connection`,
      phase: "verify",
    },
  ];
}

export function googleOAuthSetupStepIndex(
  plan: readonly GoogleOAuthSetupPlanStep[],
  progress: Pick<GoogleOAuthSetupProgress, "phase" | "service">,
): number {
  if (progress.phase === "complete") return plan.length;
  return plan.findIndex(
    (step) =>
      step.phase === progress.phase &&
      (step.phase !== "enable-api" || step.service === progress.service),
  );
}
