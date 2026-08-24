const onboardingStepValues = [
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
  "plugins",
  "automation",
  "finish",
] as const;

export type OnboardingStep = (typeof onboardingStepValues)[number];

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  "mode",
  "inference",
  "health",
  "context",
  "plugins",
  "finish",
];

const onboardingSteps = new Set<string>(ONBOARDING_STEPS);

export function isOnboardingStep(step: string): step is OnboardingStep {
  return onboardingSteps.has(step);
}

export function resumableOnboardingStep(step: string): OnboardingStep {
  if (isOnboardingStep(step)) return step;
  if (step === "automation") return "finish";
  return "plugins";
}

export function nextOnboardingStep(step: OnboardingStep) {
  return ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1] ?? "finish";
}
