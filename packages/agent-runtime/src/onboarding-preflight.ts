import type { OnboardingWorkJob } from "./types.js";

export interface OnboardingWorkPlan {
  launchableJobs: OnboardingWorkJob[];
  deferredGoogleAnalytics?: {
    setupAttemptId: string;
  };
}

export function planOnboardingWork(
  jobs: OnboardingWorkJob[],
  googleAnalyticsConnected: boolean | undefined,
): OnboardingWorkPlan {
  const googleAnalyticsSetup = jobs.find(
    (job) =>
      job.agentId === "setup" && job.setupDomain === "analytics.googleapis.com",
  );
  if (!googleAnalyticsSetup || googleAnalyticsConnected) {
    return { launchableJobs: jobs };
  }

  // Google account selection and consent must happen in the dedicated,
  // user-visible Setup conversation. A delegated onboarding child has no
  // browser authority and must never attempt this flow in the background.
  return {
    launchableJobs: jobs.filter(
      (job) => job !== googleAnalyticsSetup && job.agentId !== "analyst",
    ),
    deferredGoogleAnalytics: {
      setupAttemptId:
        googleAnalyticsSetup.setupAttemptId ?? googleAnalyticsSetup.id,
    },
  };
}
