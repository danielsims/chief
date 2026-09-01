import { Check, ExternalLink, LoaderCircle } from "lucide-react";

import type {
  EveAgentProvisioningPhase,
  EveAgentProvisioningProgress,
} from "@chief/agent-runtime/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";

export type EveConnectionPhase = EveAgentProvisioningPhase | "verifying";

const steps: readonly { phase: EveConnectionPhase; label: string }[] = [
  { phase: "validating", label: "Confirm the selected destination" },
  { phase: "uploading", label: "Upload the Eve agent" },
  { phase: "deploying", label: "Create the Vercel deployment" },
  { phase: "configuring", label: "Save the Chief connection" },
  { phase: "waiting", label: "Wait for Vercel to finish" },
  { phase: "checking", label: "Check the Chief channel" },
  { phase: "verifying", label: "Verify messaging with Chief" },
];

export function EveProvisioningDialog({
  agentName,
  endpoint,
  open,
  phase,
  progress,
}: {
  agentName: string;
  endpoint: string;
  open: boolean;
  phase: EveConnectionPhase;
  progress: EveAgentProvisioningProgress | null;
}) {
  const activeIndex = steps.findIndex((step) => step.phase === phase);
  const destination = progress?.inspectorUrl ?? progress?.deploymentUrl;
  return (
    <Dialog open={open}>
      <DialogContent
        className="min-w-0 overflow-hidden sm:max-w-md [&>button]:hidden"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Connecting {agentName}</DialogTitle>
          <DialogDescription>
            Chief is configuring the saved Eve deployment for this agent.
          </DialogDescription>
        </DialogHeader>
        <div className="bg-muted/25 rounded-xl border p-4">
          <p className="min-w-0 text-sm font-medium break-all">{endpoint}</p>
          {progress?.projectId ? (
            <p className="text-muted-foreground mt-1 text-xs">
              Vercel project {progress.projectId}
            </p>
          ) : null}
          {destination ? (
            <a
              className="text-muted-foreground hover:text-foreground mt-2 inline-flex items-center gap-1 text-xs"
              href={destination}
              target="_blank"
              rel="noreferrer"
            >
              View deployment in Vercel <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
        <div className="space-y-3 py-1">
          {steps.map((step, index) => {
            const complete = index < activeIndex;
            const active = index === activeIndex;
            return (
              <div
                key={step.phase}
                className={
                  active || complete
                    ? "flex items-center gap-3 text-sm"
                    : "text-muted-foreground flex items-center gap-3 text-sm"
                }
              >
                {complete ? (
                  <Check className="size-4 text-emerald-500" />
                ) : active ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <span className="border-muted-foreground/40 size-4 rounded-full border" />
                )}
                <span>{step.label}</span>
              </div>
            );
          })}
        </div>
        <p className="text-muted-foreground text-xs leading-5">
          This can take a few minutes while Vercel builds the deployment. You
          can follow it from the link above as soon as Vercel creates it.
        </p>
      </DialogContent>
    </Dialog>
  );
}
