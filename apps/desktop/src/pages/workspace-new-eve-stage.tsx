import { ArrowLeft, LoaderCircle } from "lucide-react";

import type { AgentDefinition } from "@chief/agent-runtime/types";
import type { RelayClient } from "@chief/relay-client";

import { AgentEveDeploymentPanel } from "../components/agents/agent-eve-deployment-panel";
import { EveProvisioningStatus } from "../components/agents/eve-provisioning-dialog";

type DestinationCatalog = Awaited<
  ReturnType<RelayClient["listVercelDestinations"]>
>;

const preparingSteps = [
  "Connect Vercel",
  "Load deployment settings",
  "Start deploy",
] as const;

export function WorkspaceEveStage({
  agent,
  autoDeploy,
  catalog,
  client,
  destination,
  selectedApps,
  workspaceName,
  workspaceId,
  onBack,
  onDeployed,
  onDestinationConfirmed,
}: {
  agent: AgentDefinition | null;
  autoDeploy: boolean;
  catalog?: DestinationCatalog;
  client: RelayClient | null;
  destination?: {
    teamId: string;
    projectMode: "new" | "existing";
    projectId: string;
    projectName: string;
  };
  selectedApps: readonly string[];
  workspaceName: string;
  workspaceId: string;
  onBack: () => void;
  onDeployed: () => Promise<void>;
  onDestinationConfirmed: () => void;
}) {
  if (!agent || !client) {
    if (autoDeploy) {
      return (
        <EveProvisioningStatus
          agentName="Chief"
          workspaceName={workspaceName}
          phase="verifying"
          progress={null}
          complete
        />
      );
    }
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-[28px] leading-tight font-normal tracking-[-0.035em]">
            Connecting Vercel Eve
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            Chief is finishing this workspace and deploying to Vercel Eve.
          </p>
        </div>
        <div className="space-y-3 py-1">
          {preparingSteps.map((label, index) => (
            <div key={label} className="flex items-center gap-3 text-sm">
              {index === 0 ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <span className="border-muted-foreground/40 size-4 rounded-full border" />
              )}
              <span
                className={index === 0 ? undefined : "text-muted-foreground"}
              >
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {!autoDeploy ? (
        <div>
          <button
            type="button"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground mb-6 flex w-fit items-center gap-1.5 text-[13px] transition-colors"
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <h1 className="text-[28px] leading-tight font-normal tracking-[-0.035em]">
            Choose a Vercel project
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            Chief and its subagents will deploy as one Eve project.
          </p>
        </div>
      ) : null}
      <AgentEveDeploymentPanel
        agent={agent}
        client={client}
        initialCatalog={catalog}
        initialDestination={destination}
        presentation="onboarding"
        destinationOnly={!autoDeploy}
        autoDeploy={autoDeploy}
        selectedApps={selectedApps}
        workspaceName={workspaceName}
        workspaceId={workspaceId}
        onCancel={onBack}
        onDestinationConfirmed={onDestinationConfirmed}
        onDeployed={onDeployed}
      />
    </div>
  );
}
