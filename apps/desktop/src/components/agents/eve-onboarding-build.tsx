import { ExternalLink } from "lucide-react";

import type {
  EveAgentProvisioningProgress,
  EveAgentProvisioningResult,
} from "@chief/agent-runtime/types";

import type { StageState } from "../../pages/onboarding/connecting-screen";
import type { EveConnectionPhase } from "./eve-provisioning-dialog";
import { ProgressStages } from "../../pages/onboarding/connecting-screen";
import { eveDeploymentSteps, VercelBuildLog } from "./eve-provisioning-dialog";

/** The design lab's Deploying Chief screen, shown in place of the settings. */
export function EveOnboardingBuild({
  phase,
  progress,
  result,
  error,
  saving,
  onContinue,
  onRetry,
  onBack,
}: {
  phase: EveConnectionPhase;
  progress: EveAgentProvisioningProgress | null;
  result: EveAgentProvisioningResult | null;
  error: string | null;
  saving: boolean;
  onContinue: () => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const failed = Boolean(error) && !saving;
  const finished = Boolean(result);
  const activeIndex = eveDeploymentSteps.findIndex((step) =>
    step.phases.includes(phase),
  );
  const states = eveDeploymentSteps.map((_, index): StageState => {
    if (finished || index < activeIndex) return "done";
    if (index !== activeIndex) return "pending";
    return failed ? "failed" : "active";
  });
  const inspectorUrl = result?.inspectorUrl ?? progress?.inspectorUrl;
  return (
    <>
      <div className="ob-heading">
        <h1>{finished ? "Chief is deployed" : "Deploying Chief"}</h1>
        <p role="status">
          {failed
            ? "The deployment stopped before Chief could connect."
            : finished
              ? "Chief is running in your Vercel account."
              : "Vercel is building Chief in your account."}
        </p>
      </div>
      <ProgressStages
        stages={eveDeploymentSteps.map((step, index) => ({
          label: step.label,
          state: states[index] ?? "pending",
        }))}
      />
      {inspectorUrl ? (
        <a
          className="ob-link inline-flex items-center gap-1"
          href={inspectorUrl}
          target="_blank"
          rel="noreferrer"
        >
          View deployment in Vercel <ExternalLink className="size-3" />
        </a>
      ) : null}
      <VercelBuildLog
        complete={finished || states[1] === "done"}
        failed={failed && Boolean(progress?.logs?.length)}
        logs={progress?.logs ?? []}
        readyState={progress?.readyState}
        running={states[1] === "active"}
        startedAt={progress?.buildStartedAt}
      />
      {failed ? (
        <div className="border-destructive/30 bg-destructive/5 rounded-lg border p-3">
          <p className="text-destructive text-sm font-medium">
            Deployment stopped
          </p>
          <p className="text-muted-foreground mt-1 text-xs leading-5">
            {error}
          </p>
        </div>
      ) : null}
      {failed ? (
        <button className="ob-primary" onClick={onRetry}>
          Try again
        </button>
      ) : (
        <button
          className="ob-primary"
          disabled={!finished}
          onClick={onContinue}
        >
          {finished ? "Continue" : "Waiting for deployment"}
        </button>
      )}
      {failed ? (
        <button className="ob-back" onClick={onBack}>
          Back to deployment settings
        </button>
      ) : null}
    </>
  );
}
