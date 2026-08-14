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
  | "plugins"
  | "automation"
  | "finish";

export const ONBOARDING_STEPS: OnboardingStep[] = [
  "mode",
  "inference",
  "health",
  "context",
  "plugins",
  "finish",
];

export function resumableOnboardingStep(step: string): OnboardingStep {
  if (ONBOARDING_STEPS.includes(step as OnboardingStep)) {
    return step as OnboardingStep;
  }
  if (step === "automation") return "finish";
  return "plugins";
}

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
