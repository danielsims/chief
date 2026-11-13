import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";

import type { SetupStep } from "./model";
import { AgentEveDeploymentPanel } from "../../components/agents/agent-eve-deployment-panel";
import { ChiefMark } from "../../components/chief-mark";
import { WorkspaceSetupChrome } from "../../components/workspace-setup-chrome";
import { relayAgentDefinitions } from "../../lib/relay-runtime-agents";
import {
  AppsScreen,
  ConnectAppsScreen,
  SetupPluginScope,
} from "./apps-screens";
import {
  ChiefScreen,
  CompanyScreen,
  ConnectScreen,
  IntroScreen,
  ProfileScreen,
  WorkspaceScreen,
} from "./setup-screens";
import {
  ApproveAgentsScreen,
  InviteAgentsScreen,
  InviteTeamScreen,
  SuccessScreen,
} from "./social-screens";
import { useWorkspaceSetup } from "./use-setup";

import "./onboarding.css";

const screenSteps: Record<SetupStep, number> = {
  profile: 0,
  workspace: 0,
  company: 0,
  intro: 1,
  chief: 1,
  connect: 2,
  eve: 2,
  apps: 3,
  plugins: 3,
  team: 4,
  invite: 5,
  approve: 5,
  success: 5,
};
export function WorkspaceSetupWizard({ onCancel }: { onCancel: () => void }) {
  const s = useWorkspaceSetup();
  const reduced = useReducedMotion();
  const main = useRef<HTMLDivElement>(null);
  useEffect(() => {
    main.current?.scrollTo(0, 0);
    const heading = main.current?.querySelector<HTMLHeadingElement>("h1");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
  }, [s.draft.step]);
  const back = () => {
    const previous: Partial<Record<SetupStep, SetupStep>> = {
      workspace: s.profile?.username ? undefined : "profile",
      company: "workspace",
      intro: s.draft.purpose === "company" ? "company" : "workspace",
      chief: "intro",
      connect: "chief",
      eve: "connect",
      apps: "connect",
      plugins: "apps",
      team: s.draft.selectedApps.length ? "plugins" : "apps",
      invite: "team",
      approve: "invite",
      success: s.agents.length ? "approve" : "invite",
    };
    const step = previous[s.draft.step];
    if (step) s.go(step);
  };
  // The first screen has nowhere to go back to; the X leaves setup.
  const canGoBack = Boolean(
    s.draft.step !== "profile" &&
    !(s.draft.step === "workspace" && s.profile?.username),
  );
  const components = {
    profile: ProfileScreen,
    workspace: WorkspaceScreen,
    company: CompanyScreen,
    intro: IntroScreen,
    chief: ChiefScreen,
    connect: ConnectScreen,
    apps: AppsScreen,
    plugins: ConnectAppsScreen,
    team: InviteTeamScreen,
    invite: InviteAgentsScreen,
    approve: ApproveAgentsScreen,
    success: SuccessScreen,
  };
  const Screen = s.draft.step !== "eve" ? components[s.draft.step] : null;
  const eveAgent = s.snapshot
    ? relayAgentDefinitions(s.snapshot).find((a) => a.id === "chief")
    : null;
  return (
    <div className="ob-shell">
      <div data-tauri-drag-region className="ob-drag" />
      <WorkspaceSetupChrome onExit={onCancel} />
      <PluginStepScope setup={s}>
        <div className="ob-scroll" ref={main}>
          <motion.div
            className="ob-screen"
            key={s.draft.step}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="ob-top">
              <ChiefMark className="size-6" />
              <div
                className="ob-progress"
                aria-label={`Step ${screenSteps[s.draft.step] + 1} of 6`}
              >
                {Array.from({ length: 6 }, (_, i) => (
                  <span
                    key={i}
                    className={i <= screenSteps[s.draft.step] ? "active" : ""}
                  />
                ))}
              </div>
            </header>
            <div>
              <div className="ob-body">
                {s.loading ? (
                  <div
                    role="status"
                    aria-label="Loading setup"
                    className="flex flex-col gap-6 motion-safe:animate-pulse"
                  >
                    <div className="bg-muted h-6 w-52 rounded-md" />
                    <div className="bg-muted h-4 w-full rounded-md" />
                    <div className="bg-muted mt-3 h-10 rounded-lg" />
                    <div className="bg-muted h-10 rounded-lg" />
                  </div>
                ) : !s.profile ? (
                  <>
                    <p className="ob-error" role="alert">
                      {s.error ?? "Your profile could not be loaded."}
                    </p>
                    <button className="ob-primary" onClick={s.retry}>
                      Try again
                    </button>
                  </>
                ) : s.draft.step === "eve" ? (
                  eveAgent && s.client ? (
                    <AgentEveDeploymentPanel
                      agent={eveAgent}
                      client={s.client}
                      presentation="onboarding"
                      selectedApps={s.draft.selectedApps}
                      workspaceName={s.draft.name}
                      workspaceId={s.draft.workspaceId ?? undefined}
                      onCancel={() => s.go("connect")}
                      onDeployed={async () => {
                        if (s.client) {
                          const snapshot = await s.client.setupSnapshot();
                          if (
                            !snapshot.agents.some(
                              (a) =>
                                a.id === "chief" &&
                                a.runtime.kind === "external-channel" &&
                                a.runtime.connectionStatus === "connected",
                            )
                          )
                            throw new Error(
                              "Chief’s connection has not been verified yet.",
                            );
                          s.patch({ step: "apps" });
                        }
                      }}
                    />
                  ) : (
                    <p>Reconnecting to your workspace…</p>
                  )
                ) : (s.draft.step === "apps" || s.draft.step === "plugins") &&
                  !s.client ? (
                  <p>Reconnecting to your workspace…</p>
                ) : Screen ? (
                  <Screen setup={s} />
                ) : null}
                {s.profile && s.error ? (
                  <p className="ob-error" role="alert">
                    {s.error}
                  </p>
                ) : null}
                {!s.loading && s.profile && canGoBack ? (
                  <button className="ob-back" disabled={s.busy} onClick={back}>
                    Back
                  </button>
                ) : null}
              </div>
            </div>
          </motion.div>
        </div>
      </PluginStepScope>
    </div>
  );
}

/** Picking and connecting apps share one plugin runtime, so going between them never reloads the catalog. */
function PluginStepScope({
  setup,
  children,
}: {
  setup: ReturnType<typeof useWorkspaceSetup>;
  children: ReactNode;
}) {
  return (setup.draft.step === "apps" || setup.draft.step === "plugins") &&
    setup.client ? (
    <SetupPluginScope setup={setup}>{children}</SetupPluginScope>
  ) : (
    children
  );
}
