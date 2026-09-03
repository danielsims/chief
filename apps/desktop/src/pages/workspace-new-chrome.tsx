import { ArrowLeft } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { TooltipProvider } from "@chief/ui/components/tooltip";

import type { WorkspaceNewPageModel } from "./workspace-new-state";
import { USING_CUSTOM_RELAY } from "../lib/config";
import { UserIndicator } from "./onboarding-presentation";
import { eveDestinationIsReady } from "./workspace-create-draft";
import { CreateForm, JoinForm } from "./workspace-new-components";
import { WorkspaceEveStage } from "./workspace-new-eve-stage";
import {
  eveProgressStep,
  forgetPendingVercelToken,
  onboardingStage,
  shouldLoadEveDestinations,
} from "./workspace-new-flow";
import { ForeignRelayInvite } from "./workspace-new-supplementary";

export function WorkspaceProgress({
  step,
  total,
}: {
  step: number;
  total: number;
}) {
  return (
    <div
      className="fixed top-[43px] left-1/2 z-50 flex w-52 -translate-x-1/2 gap-2"
      aria-label={`Step ${step + 1} of ${total}`}
    >
      {Array.from({ length: total }, (_, position) => position).map(
        (position) => (
          <span
            key={position}
            className={`h-[3px] flex-1 rounded-full transition-colors duration-300 ${position <= step ? "bg-foreground" : "bg-muted"}`}
          />
        ),
      )}
    </div>
  );
}

export function WorkspaceHome({
  onBack,
  onCreate,
  onJoin,
}: {
  onBack?: () => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground mb-8 flex w-fit items-center gap-1.5 text-[13px] transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </button>
      ) : null}
      <div>
        <h1 className="text-[32px] leading-tight font-normal tracking-[-0.04em]">
          Set up your workspace
        </h1>
        <p className="text-muted-foreground mt-2 max-w-lg text-sm leading-6">
          Start somewhere new or join a workspace shared with you.
        </p>
      </div>

      <div className="border-border/60 bg-card/30 mt-8 divide-y overflow-hidden rounded-xl border">
        <WorkspaceAction
          title="Create a workspace"
          description="Start a new space for your agents and team"
          onClick={onCreate}
        />
        <WorkspaceAction
          title="Join with an invitation"
          description="Open a workspace someone shared with you"
          onClick={onJoin}
        />
      </div>
    </>
  );
}

export function WorkspaceAction({
  title,
  description,
  onClick,
  disabled = false,
}: {
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="hover:bg-foreground/[0.035] focus-visible:bg-foreground/[0.035] flex w-full items-center px-4 py-4 text-left transition-colors duration-150 outline-none disabled:opacity-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="text-muted-foreground mt-0.5 block text-xs">
          {description}
        </span>
      </span>
    </button>
  );
}

export function WorkspaceNewView({ page }: { page: WorkspaceNewPageModel }) {
  const reducedMotion = useReducedMotion();
  const transitionKey =
    page.mode === "create"
      ? `create:${page.createStep}`
      : page.mode === "join"
        ? `join:${page.foreignRelay ? "relay" : page.invitePreview ? "preview" : "invite"}`
        : page.mode;

  return (
    <TooltipProvider delayDuration={250}>
      <div className="bg-background text-foreground flex h-screen overflow-hidden">
        <UserIndicator user={page.user} onSignOut={page.onSignOut} />
        <div className="bg-background flex min-w-0 flex-1 flex-col">
          {page.mode === "create" || page.mode === "eve" ? (
            <WorkspaceProgress
              step={
                page.agentRuntime === "vercel-eve"
                  ? eveProgressStep(
                      page.mode,
                      page.createStep,
                      page.eveAutoDeploy,
                    )
                  : page.createStep
              }
              total={4}
            />
          ) : null}
          <header data-tauri-drag-region className="h-[72px] shrink-0" />
          <main className="flex min-h-0 flex-1 overflow-y-auto px-6 pb-10">
            <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col justify-center py-12">
              <AnimatePresence
                initial={false}
                mode="wait"
                custom={page.transitionDirection}
              >
                <motion.div
                  key={transitionKey}
                  custom={page.transitionDirection}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  variants={{
                    enter: (direction: 1 | -1) => ({
                      opacity: reducedMotion ? 1 : 0,
                      y: reducedMotion ? 0 : direction > 0 ? 10 : -8,
                    }),
                    center: { opacity: 1, y: 0 },
                    exit: (direction: 1 | -1) => ({
                      opacity: reducedMotion ? 1 : 0,
                      y: reducedMotion ? 0 : direction > 0 ? -6 : 6,
                    }),
                  }}
                  transition={{
                    duration: reducedMotion ? 0 : 0.2,
                    ease: "easeOut",
                  }}
                >
                  {page.mode === "home" ? (
                    <WorkspaceHome
                      onBack={
                        page.canReturnToWorkspace
                          ? () => void page.returnToExistingWorkspace()
                          : undefined
                      }
                      onCreate={() => {
                        page.recordOnboardingEvent(
                          "advanced",
                          "workspace-home",
                        );
                        window.sessionStorage.setItem(
                          page.activeCreateKey,
                          "active",
                        );
                        page.setTransitionDirection(1);
                        page.setActionError(null);
                        page.setCreateStep(0);
                        page.setMode("create");
                        void page.navigate("/workspaces/new?intent=create", {
                          replace: true,
                        });
                      }}
                      onJoin={() => {
                        page.setTransitionDirection(1);
                        page.setActionError(null);
                        page.setMode("join");
                      }}
                    />
                  ) : page.mode === "join" ? (
                    <button
                      type="button"
                      onClick={page.returnToWorkspaceHome}
                      disabled={page.isWorking}
                      className="text-muted-foreground hover:text-foreground mb-8 flex w-fit items-center gap-1.5 text-[13px] transition-colors disabled:opacity-50"
                    >
                      <ArrowLeft size={14} />
                      Back
                    </button>
                  ) : null}

                  {page.mode === "create" ? (
                    <CreateForm
                      name={page.name}
                      website={page.website}
                      provider={page.provider}
                      apiKey={page.apiKey}
                      vercelAccessToken={page.vercelAccessToken}
                      selectedApps={page.selectedApps}
                      working={page.isWorking || page.eveDestinationLoading}
                      connected={page.connected}
                      agentRuntime={page.agentRuntime}
                      eveDestination={{
                        loading: page.eveDestinationLoading,
                        teamId: page.eveTeamId,
                        projectMode: page.eveProjectMode,
                        projectId: page.eveProjectId,
                        projectName: page.eveProjectName,
                        teams: page.eveDestinationCatalog.teams,
                        projects: page.eveDestinationCatalog.projects,
                        ready: eveDestinationIsReady({
                          eveTeamId: page.eveTeamId,
                          eveProjectMode: page.eveProjectMode,
                          eveProjectId: page.eveProjectId,
                          eveProjectName: page.eveProjectName,
                        }),
                      }}
                      relayRuntimeLabel={
                        USING_CUSTOM_RELAY ? "Self-hosted Cell" : "Chief Cloud"
                      }
                      error={page.actionError}
                      step={page.createStep}
                      onNameChange={page.setName}
                      onWebsiteChange={page.setWebsite}
                      onAgentRuntimeChange={(nextRuntime) => {
                        page.setAgentRuntime(nextRuntime);
                        if (nextRuntime === "vercel-eve") {
                          page.setProvider("vercelAiGateway");
                          page.setApiKey("");
                        }
                        page.setActionError(null);
                      }}
                      onProviderChange={(nextProvider) => {
                        page.setProvider(nextProvider);
                        page.setApiKey("");
                      }}
                      onApiKeyChange={page.setApiKey}
                      onVercelAccessTokenChange={page.setVercelAccessToken}
                      onEveDestinationChange={{
                        onTeam: (value) => {
                          page.setEveTeamId(value);
                          page.setEveProjectId("");
                          void page.loadEveDestinations(value);
                        },
                        onMode: page.setEveProjectMode,
                        onProject: page.setEveProjectId,
                        onProjectName: page.setEveProjectName,
                      }}
                      onSelectedAppsChange={page.setSelectedApps}
                      onStepChange={(nextStep) => {
                        page.recordOnboardingEvent(
                          "advanced",
                          onboardingStage(
                            "create",
                            page.createStep,
                            page.agentRuntime,
                          ) ?? "workspace-profile",
                          {
                            agentRuntime: page.agentRuntime,
                            provider: page.provider ?? undefined,
                            selectedAppCount: page.selectedApps.size,
                          },
                        );
                        if (
                          shouldLoadEveDestinations(
                            page.agentRuntime,
                            page.createStep,
                            nextStep,
                          )
                        ) {
                          void (async () => {
                            page.setIsWorking(true);
                            const ok = await page.loadEveDestinations(
                              page.eveTeamId || undefined,
                            );
                            page.setIsWorking(false);
                            if (!ok) return;
                            page.setTransitionDirection(1);
                            page.setCreateStep(2);
                          })();
                          return;
                        }
                        page.setTransitionDirection(
                          nextStep > page.createStep ? 1 : -1,
                        );
                        page.setCreateStep(nextStep);
                      }}
                      onBackToHome={() => {
                        page.setTransitionDirection(-1);
                        page.leaveCreateFlow();
                      }}
                      onSubmit={() => void page.createWorkspace()}
                    />
                  ) : null}

                  {page.mode === "eve" ? (
                    <WorkspaceEveStage
                      agent={page.eveAgent}
                      autoDeploy={page.eveAutoDeploy}
                      catalog={page.eveDestinationCatalog}
                      client={page.resolvedEveWorkspace?.client ?? null}
                      workspaceName={
                        page.resolvedEveWorkspace?.snapshot.name ?? page.name
                      }
                      workspaceId={page.resolvedEveWorkspace?.snapshot.id ?? ""}
                      selectedApps={Array.from(page.selectedApps).sort()}
                      destination={{
                        teamId: page.eveTeamId,
                        projectMode:
                          page.eveProjectMode === ""
                            ? "new"
                            : page.eveProjectMode,
                        projectId: page.eveProjectId,
                        projectName: page.eveProjectName,
                      }}
                      onDestinationConfirmed={() => {
                        page.setTransitionDirection(1);
                        page.setCreateStep(3);
                        page.setMode("create");
                      }}
                      onBack={() => {
                        page.setTransitionDirection(-1);
                        page.setEveAutoDeploy(false);
                        page.setCreateStep(1);
                        page.setMode("create");
                      }}
                      onDeployed={async () => {
                        const workspaceId =
                          page.resolvedEveWorkspace?.snapshot.id;
                        try {
                          if (
                            workspaceId &&
                            page.relaySnapshotId !== workspaceId
                          ) {
                            await page.switchWorkspace(workspaceId);
                          } else {
                            await page.refreshRelay();
                          }
                          forgetPendingVercelToken(page.createDraftKey);
                          window.localStorage.removeItem(page.createDraftKey);
                          void page.navigate("/", { replace: true });
                        } finally {
                          window.sessionStorage.removeItem(
                            page.activeCreateKey,
                          );
                        }
                      }}
                    />
                  ) : null}

                  {page.mode === "join" && page.foreignRelay ? (
                    <ForeignRelayInvite
                      relayUrl={page.foreignRelay.relayUrl}
                      working={page.isWorking}
                      error={page.actionError}
                      onCancel={() => {
                        page.setTransitionDirection(-1);
                        page.setForeignRelay(null);
                        page.setActionError(null);
                      }}
                      onContinue={() => void page.connectToInviteRelay()}
                    />
                  ) : page.mode === "join" ? (
                    <JoinForm
                      invite={page.invite}
                      preview={page.invitePreview}
                      working={page.isWorking}
                      connected={page.connected}
                      onInviteChange={(value) => {
                        page.setInvite(value);
                        page.setInvitePreview(null);
                        page.setForeignRelay(null);
                      }}
                      onPrepare={() => void page.prepareInvite()}
                      onJoin={() => void page.joinWorkspace()}
                    />
                  ) : null}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
