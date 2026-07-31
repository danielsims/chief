import { Check, LoaderCircle } from "lucide-react";

import type { IntegrationSetupProgress } from "@chief/agent-runtime/types";
import type { GoogleOAuthSetupProgress } from "@chief/google-oauth-connector";
import {
  browserCredentialSetupRecipe,
  integrationSetupStepIndex,
} from "@chief/agent-runtime/integration-setup-recipes";
import {
  googleAnalyticsRecipe,
  googleOAuthSetupPlan,
  googleOAuthSetupStepIndex,
} from "@chief/google-oauth-connector";

const GOOGLE_ANALYTICS_SETUP_PLAN = googleOAuthSetupPlan(googleAnalyticsRecipe);

export function SetupProgressList({
  recipeId,
  progress,
}: {
  recipeId: string;
  progress?: IntegrationSetupProgress;
}) {
  const browserRecipe = browserCredentialSetupRecipe(
    progress?.recipeId ?? recipeId,
  );
  const isGoogleAnalytics =
    recipeId === "analytics.googleapis.com" ||
    progress?.recipeId === "google-analytics";
  const plan = isGoogleAnalytics
    ? GOOGLE_ANALYTICS_SETUP_PLAN
    : (browserRecipe?.steps ?? []);
  const currentIndex = progress
    ? isGoogleAnalytics
      ? googleOAuthSetupStepIndex(GOOGLE_ANALYTICS_SETUP_PLAN, {
          phase: progress.phase as GoogleOAuthSetupProgress["phase"],
          service: progress.service,
        })
      : integrationSetupStepIndex(plan, progress.phase)
    : 0;

  if (plan.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-3xl border-y px-3 py-4">
      <p className="text-muted-foreground mb-3 text-[11px] font-medium">
        {isGoogleAnalytics
          ? "Google Analytics setup"
          : `${browserRecipe?.name ?? recipeId} setup`}
      </p>
      <ol className="space-y-2.5">
        {plan.map((step, index) => {
          const complete =
            currentIndex >= GOOGLE_ANALYTICS_SETUP_PLAN.length ||
            index < currentIndex;
          const active = index === currentIndex;
          return (
            <li
              key={step.id}
              className={`flex items-center gap-2.5 text-xs ${
                complete
                  ? "text-muted-foreground/55 line-through"
                  : active
                    ? "text-foreground"
                    : "text-muted-foreground/45"
              }`}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {complete ? (
                  <Check size={12} />
                ) : active ? (
                  <LoaderCircle
                    className={
                      progress?.status === "error" ? "" : "animate-spin"
                    }
                    size={12}
                  />
                ) : (
                  <span className="border-muted-foreground/30 size-2 border" />
                )}
              </span>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ol>
      {progress?.instruction ? (
        <p
          className={`mt-4 text-xs leading-5 ${
            progress.status === "error"
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {progress.instruction}
        </p>
      ) : null}
    </section>
  );
}
