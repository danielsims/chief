import type { ErrorInfo, ReactNode } from "react";
import { Component, lazy, Suspense, useMemo } from "react";
import { Claude, OpenAI, OpenCode } from "@lobehub/icons";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { Toaster } from "sonner";

import { Button } from "@chief/ui/components/button";

import type { ProviderMark } from "./components/agent-avatar";
import { AgentAppearanceContext } from "./components/agent-avatar";
import { MentionPeopleProvider } from "./components/chat/mention-people-context";
import { PluginToolCardsPreview } from "./components/chat/plugin-tool-card";
import { ChiefNavigationProvider } from "./components/chief-navigation-provider";
import { EntryState, WorkspaceEntryState } from "./components/entry-state";
import { Layout } from "./components/layout";
import { PageTitle } from "./components/page-title";
import { RelayConnectionDialog } from "./components/relay-connection-control";
import { AgentConfigProvider } from "./lib/agent-config";
import { AuthProvider, useAuth } from "./lib/auth/auth-context";
import { ChannelReadStateProvider } from "./lib/channel-read-state-context";
import { missingDesktopConfiguration, RELAY_URL } from "./lib/config";
import { RelaySessionProvider, useRelaySession } from "./lib/relay-session";
import { RuntimeProvider, useRuntime } from "./lib/runtime";
import { ThemeProvider, useTheme } from "./lib/theme";
import { WorkspaceChannelsProvider } from "./lib/workspace-channels-context";
import {
  pendingCreateRelayKey,
  shouldResumeWorkspaceCreate,
  shouldStayOnWorkspaceCreate,
} from "./lib/workspace-entry";
import { AgentsPage } from "./pages/agents";
import { ArtifactDatabasePage } from "./pages/artifact-database";
import { ArtifactsPage } from "./pages/artifacts";
import { ConversationsPage } from "./pages/conversations";
import { DashboardPage } from "./pages/dashboard";
import { InboxPage } from "./pages/inbox";
import { OnboardingPage } from "./pages/onboarding";
import { SchedulePage } from "./pages/schedule";
import { AppearanceSettings } from "./pages/settings/appearance";
import { ConnectionSettings } from "./pages/settings/connection";
import { EnvironmentSettings } from "./pages/settings/environment";
import { SettingsLayout } from "./pages/settings/layout";
import { NotificationsSettings } from "./pages/settings/notifications";
import { ProfileSettings } from "./pages/settings/profile";
import { WebhooksSettings } from "./pages/settings/webhooks";
import { WorkspaceSettings } from "./pages/settings/workspace";
import { SignInScreen } from "./pages/sign-in";
import { WorkspaceFilePage } from "./pages/workspace-file";
import { CreateWorkspacePage } from "./pages/workspace-new";

const BoardsPage = lazy(() =>
  import("./pages/boards").then((module) => ({
    default: module.BoardsPage,
  })),
);
const AutomationsPage = lazy(() =>
  import("./pages/automations").then((module) => ({
    default: module.AutomationsPage,
  })),
);
const AutomationBuilderPage = lazy(() =>
  import("./pages/automation-builder").then((module) => ({
    default: module.AutomationBuilderPage,
  })),
);
const PluginsPage = lazy(() =>
  import("./pages/plugins").then((module) => ({ default: module.PluginsPage })),
);
const PluginsPagePreview = lazy(() =>
  import("./pages/plugins").then((module) => ({
    default: module.PluginsPagePreview,
  })),
);
const ProjectsPage = lazy(() =>
  import("./pages/projects").then((module) => ({
    default: module.ProjectsPage,
  })),
);
const MachinesPage = lazy(() =>
  import("./pages/machines").then((module) => ({
    default: module.MachinesPage,
  })),
);

const openCodeMark: ProviderMark = {
  Mark: OpenCode,
  tileClassName: "bg-white text-black",
};

/** Logos for the providers that run agents on this device, each on its own
 * brand colour, by provider. */
const LOCAL_PROVIDER_MARKS: Partial<Record<string, ProviderMark>> = {
  claude: { Mark: Claude, tileClassName: "bg-[#D97757] text-white" },
  codex: { Mark: OpenAI, tileClassName: "bg-white text-black" },
  opencode: openCodeMark,
  openCodeGo: openCodeMark,
};

/** Supplies every agent's avatar from the live roster, with provider logos for
 * on-device agents that have none. It follows the runtime's roster, which
 * changes as soon as an agent is created or reconfigured. */
function AgentAppearanceProvider({ children }: { children: ReactNode }) {
  const { agents } = useRuntime();
  const value = useMemo(() => {
    const profiles = agents.flatMap((agent) => [
      agent,
      ...(agent.subagents ?? []),
    ]);
    return {
      providerMarks: new Map(
        profiles.flatMap((agent) => {
          const mark = agent.provider
            ? LOCAL_PROVIDER_MARKS[agent.provider]
            : undefined;
          return mark ? [[agent.id, mark] as const] : [];
        }),
      ),
      agentIds: new Map(
        profiles.map((agent) => [agent.name.toLowerCase(), agent.id] as const),
      ),
      avatars: new Map(
        profiles.flatMap((agent) =>
          agent.avatar ? [[agent.id, agent.avatar] as const] : [],
        ),
      ),
    };
  }, [agents]);
  return (
    <AgentAppearanceContext.Provider value={value}>
      {children}
    </AgentAppearanceContext.Provider>
  );
}

function ConfigurationRequired() {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-6">
      <section className="bg-card w-full max-w-lg rounded-xl border p-8">
        <PageTitle>Configure this build</PageTitle>
        <p className="text-muted-foreground mt-3 text-sm leading-6">
          This copy of Chief is not connected to a backend. Add the missing
          development values, then restart the app.
        </p>
        <div className="text-muted-foreground mt-6 border px-4 py-3 font-mono text-xs leading-6 whitespace-pre-line">
          {missingDesktopConfiguration.join("\n")}
        </div>
        <p className="text-muted-foreground mt-4 text-xs leading-5">
          Start with apps/desktop/.env.example. Official Chief releases receive
          their configuration from the private release environment.
        </p>
      </section>
    </main>
  );
}

function OnboardingGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const relay = useRelaySession();
  const resumesWorkspaceCreate = shouldResumeWorkspaceCreate(
    window.sessionStorage.getItem(pendingCreateRelayKey),
    RELAY_URL,
  );

  const staysOnWorkspaceCreate = shouldStayOnWorkspaceCreate(
    location.search,
    window.sessionStorage,
  );

  // Only the first load shows the entry screen. Once a workspace is on
  // screen, background reconnects must never unmount the app and lose work.
  if (
    relay.loading &&
    !relay.snapshot &&
    !(location.pathname === "/workspaces/new" && staysOnWorkspaceCreate)
  ) {
    return <WorkspaceEntryState />;
  }

  if (!relay.snapshot && relay.error) {
    return <RelayUnavailableState />;
  }

  if (resumesWorkspaceCreate && location.pathname !== "/workspaces/new") {
    return <Navigate to="/workspaces/new?intent=create" replace />;
  }

  if (location.pathname === "/workspaces/new") {
    if (relay.snapshot && !staysOnWorkspaceCreate) {
      return <Navigate to="/" replace />;
    }
    return children;
  }

  if (!relay.snapshot) {
    return <Navigate to="/workspaces/new" replace />;
  }

  return location.pathname === "/onboarding" ? (
    <Navigate to="/" replace />
  ) : (
    children
  );
}

function RelayUnavailableState() {
  const relay = useRelaySession();
  const { signOut } = useAuth();
  return (
    <Layout workspaceNavigationAvailable={false}>
      <main className="flex min-h-full items-center justify-center px-6 py-12">
        <section className="w-full max-w-md">
          <PageTitle>Workspace unavailable</PageTitle>
          <p className="text-muted-foreground mt-3 text-sm leading-6">
            {relay.error}
          </p>
          <p className="text-muted-foreground mt-3 text-sm leading-6">
            Choose another relay or try this one again. Your work remains on the
            relay where it was created.
          </p>
          <div className="mt-6 flex gap-2">
            <RelayConnectionDialog>
              <Button>Change relay</Button>
            </RelayConnectionDialog>
            <Button
              variant="outline"
              onClick={() => void relay.refresh()}
              disabled={relay.loading}
            >
              {relay.loading ? "Connecting…" : "Try again"}
            </Button>
            {relay.recoveryWorkspace ? (
              <Button
                variant="ghost"
                onClick={() => void relay.returnToPreviousWorkspace()}
              >
                Back
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => signOut()}>
              Sign out
            </Button>
          </div>
        </section>
      </main>
    </Layout>
  );
}

class AppErrorBoundary extends Component<
  {
    children: ReactNode;
    onAuthenticationLost?: () => void;
    resetKey?: string;
  },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Chief] Unhandled render error", error, info);
    if (
      error.message.includes("UNAUTHENTICATED") ||
      error.message.includes("You must be signed in")
    ) {
      this.props.onAuthenticationLost?.();
    }
  }

  componentDidUpdate(
    previousProps: Readonly<{
      children: ReactNode;
      onAuthenticationLost?: () => void;
      resetKey?: string;
    }>,
  ) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-6">
        <section className="bg-card w-full max-w-md rounded-xl border p-8">
          <PageTitle>Chief hit a problem</PageTitle>
          <p className="text-muted-foreground mt-3 text-sm leading-6">
            Your work is safe. Reload the app to reconnect to this workspace.
          </p>
          <Button className="mt-6" onClick={() => window.location.reload()}>
            Reload Chief
          </Button>
          <details className="text-muted-foreground mt-6 text-xs">
            <summary className="cursor-pointer">Technical details</summary>
            <p className="mt-2 font-mono leading-5 break-words">
              {this.state.error.message}
            </p>
          </details>
        </section>
      </main>
    );
  }
}

function AuthSessionBoundary({ children }: { children: ReactNode }) {
  const { invalidateSession, sessionToken } = useAuth();
  return (
    <AppErrorBoundary
      onAuthenticationLost={invalidateSession}
      resetKey={sessionToken ?? "signed-out"}
    >
      {children}
    </AppErrorBoundary>
  );
}

function AuthenticatedApp() {
  const { isAuthenticated, isLoading } = useAuth();
  const { resolved } = useTheme();

  if (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("preview") === "plugins"
  ) {
    return (
      <Suspense fallback={null}>
        <PluginsPagePreview />
      </Suspense>
    );
  }

  if (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("preview") ===
      "agent-plugin-cards"
  ) {
    return <PluginToolCardsPreview />;
  }

  if (isLoading) {
    return <EntryState />;
  }

  if (!isAuthenticated) {
    return <SignInScreen />;
  }

  return (
    <RuntimeProvider>
      <Toaster
        closeButton
        position="bottom-right"
        theme={resolved}
        toastOptions={{
          classNames: {
            actionButton: "chief-toast-action",
            closeButton: "chief-toast-close",
            description: "chief-toast-description",
            toast: "chief-toast",
            title: "chief-toast-title",
          },
          style: { borderRadius: 10 },
        }}
      />
      <AgentConfigProvider>
        <AgentAppearanceProvider>
          <BrowserRouter>
            <ChiefNavigationProvider>
              <WorkspaceChannelsProvider>
                <MentionPeopleProvider>
                  <ChannelReadStateProvider>
                    <OnboardingGate>
                      <Routes>
                        <Route
                          path="workspaces/new"
                          element={<CreateWorkspacePage />}
                        />
                        <Route path="onboarding" element={<OnboardingPage />} />
                        <Route element={<Layout />}>
                          <Route index element={<DashboardPage />} />
                          <Route path="inbox" element={<InboxPage />} />
                          <Route path="schedule" element={<SchedulePage />} />
                          <Route
                            path="schedule/automations"
                            element={
                              <Suspense fallback={null}>
                                <AutomationsPage />
                              </Suspense>
                            }
                          />
                          <Route
                            path="schedule/automations/:automationId"
                            element={
                              <Suspense fallback={null}>
                                <AutomationBuilderPage />
                              </Suspense>
                            }
                          />
                          <Route
                            path="conversations"
                            element={<ConversationsPage />}
                          />
                          <Route path="agents" element={<AgentsPage />} />
                          <Route
                            path="machines"
                            element={
                              <Navigate to="/settings/machines" replace />
                            }
                          />
                          <Route
                            path="repositories/:projectId?"
                            element={
                              <Suspense fallback={null}>
                                <ProjectsPage />
                              </Suspense>
                            }
                          />
                          <Route
                            path="plugins"
                            element={
                              <Suspense fallback={null}>
                                <PluginsPage />
                              </Suspense>
                            }
                          />
                          <Route
                            path="boards"
                            element={
                              <Suspense fallback={null}>
                                <BoardsPage />
                              </Suspense>
                            }
                          />
                          <Route path="artifacts" element={<ArtifactsPage />} />
                          <Route
                            path="artifacts/databases/:databaseId"
                            element={<ArtifactDatabasePage />}
                          />
                          <Route
                            path="artifacts/:fileId"
                            element={<WorkspaceFilePage />}
                          />
                          <Route path="settings" element={<SettingsLayout />}>
                            <Route
                              index
                              element={
                                <Navigate to="/settings/profile" replace />
                              }
                            />
                            <Route
                              path="profile"
                              element={<ProfileSettings />}
                            />
                            <Route
                              path="workspace"
                              element={<WorkspaceSettings />}
                            />
                            <Route
                              path="connection"
                              element={<ConnectionSettings />}
                            />
                            <Route
                              path="webhooks"
                              element={<WebhooksSettings />}
                            />
                            <Route
                              path="appearance"
                              element={<AppearanceSettings />}
                            />
                            <Route
                              path="notifications"
                              element={<NotificationsSettings />}
                            />
                            <Route
                              path="environment"
                              element={<EnvironmentSettings />}
                            />
                            <Route
                              path="machines"
                              element={<SettingsMachines />}
                            />
                            <Route
                              path="integrations/*"
                              element={<Navigate to="/plugins" replace />}
                            />
                          </Route>
                        </Route>
                      </Routes>
                    </OnboardingGate>
                  </ChannelReadStateProvider>
                </MentionPeopleProvider>
              </WorkspaceChannelsProvider>
            </ChiefNavigationProvider>
          </BrowserRouter>
        </AgentAppearanceProvider>
      </AgentConfigProvider>
    </RuntimeProvider>
  );
}

export default function App() {
  if (missingDesktopConfiguration.length > 0) {
    return <ConfigurationRequired />;
  }

  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <AuthSessionBoundary>
            <RelaySessionProvider>
              <AuthenticatedApp />
            </RelaySessionProvider>
          </AuthSessionBoundary>
        </AuthProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  );
}

function SettingsMachines() {
  return (
    <Suspense fallback={null}>
      <MachinesPage />
    </Suspense>
  );
}
