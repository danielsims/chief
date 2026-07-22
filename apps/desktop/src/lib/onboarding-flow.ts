export type OnboardingStep =
  | "mode"
  | "inference"
  | "health"
  | "context"
  | "brand"
  | "socials"
  | "selling"
  | "audience"
  | "success"
  | "time"
  | "monitoring"
  | "analytics"
  | "ads"
  | "adsBudget"
  | "aeo"
  | "engineering"
  | "engineeringTools"
  | "automation"
  | "pricing"
  | "finish";

export const ONBOARDING_STEPS: OnboardingStep[] = [
  "mode",
  "inference",
  "health",
  "context",
  "brand",
  "socials",
  "selling",
  "audience",
  "success",
  "time",
  "monitoring",
  "analytics",
  "ads",
  "adsBudget",
  "engineering",
  "engineeringTools",
  "aeo",
  "automation",
  "pricing",
  "finish",
];

export function nextOnboardingStep(step: OnboardingStep) {
  return ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1] ?? "finish";
}

export const LOCAL_ONBOARDING_FALLBACK = {
  workspaceMode: "local",
  providerMode: "local",
  provider: null,
  deploymentProvider: null,
  cloudDeploymentUrl: "",
  step: "inference",
} as const;
