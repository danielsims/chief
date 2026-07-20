import type { OnboardingWorkJob } from "./types.js";
import { GOOGLE_ANALYTICS_DOMAIN } from "./integration-requests.js";

export interface OnboardingWorkPlan {
  launchableJobs: OnboardingWorkJob[];
  deferredGoogleAnalytics?: {
    setupAttemptId: string;
  };
}

export function planOnboardingWork(
  jobs: OnboardingWorkJob[],
  googleAnalyticsCredentialsReady: boolean | undefined,
): OnboardingWorkPlan {
  const googleAnalyticsSetup = jobs.find(
    (job) =>
      job.agentId === "setup" && job.setupDomain === GOOGLE_ANALYTICS_DOMAIN,
  );
  if (
    !googleAnalyticsSetup ||
    googleAnalyticsCredentialsReady !== false ||
    !googleAnalyticsSetup.setupAttemptId
  ) {
    return { launchableJobs: jobs };
  }

  return {
    launchableJobs: jobs.filter(
      (job) => job !== googleAnalyticsSetup && job.agentId !== "analyst",
    ),
    deferredGoogleAnalytics: {
      setupAttemptId: googleAnalyticsSetup.setupAttemptId,
    },
  };
}
