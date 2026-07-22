import { Check, LoaderCircle } from "lucide-react";

import type { IntegrationSetupProgress } from "@chief/agent-runtime/types";
import {
  googleAnalyticsRecipe,
  googleOAuthSetupPlan,
  googleOAuthSetupStepIndex,
} from "@chief/google-oauth-connector";

const GOOGLE_ANALYTICS_SETUP_PLAN = googleOAuthSetupPlan(googleAnalyticsRecipe);

export function SetupProgressList({
  progress,
}: {
  progress?: IntegrationSetupProgress;
}) {
  const currentIndex = progress
    ? googleOAuthSetupStepIndex(GOOGLE_ANALYTICS_SETUP_PLAN, progress)
    : 0;

  return (
    <section className="mx-auto w-full max-w-3xl border-y px-3 py-4">
      <p className="text-muted-foreground mb-3 text-[11px] font-medium">
        Google Analytics setup
      </p>
      <ol className="space-y-2.5">
        {GOOGLE_ANALYTICS_SETUP_PLAN.map((step, index) => {
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
