import type { ErrorInfo, ReactNode } from "react";
import { Component, lazy, Suspense, useEffect, useState } from "react";
import { useConvexAuth } from "convex/react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { Toaster } from "sonner";

import { Button } from "@chief/ui/components/button";

import { PluginToolCardsPreview } from "./components/chat/plugin-tool-card";
import { ChiefNavigationProvider } from "./components/chief-navigation-provider";
import { EntryState } from "./components/entry-state";
import { Layout } from "./components/layout";
import { PageTitle } from "./components/page-title";
import { AgentConfigProvider } from "./lib/agent-config";
import { AuthProvider, useAuth } from "./lib/auth/auth-context";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
} from "./lib/auth/better-auth-client";
import { ChannelReadStateProvider } from "./lib/channel-read-state-context";
import { missingDesktopConfiguration } from "./lib/config";
import { ConvexClientProvider } from "./lib/convex";
import { RuntimeProvider } from "./lib/runtime";
import { ThemeProvider, useTheme } from "./lib/theme";
import { AgentsPage } from "./pages/agents";
import { AnalyticsPage } from "./pages/analytics";
import { ArtifactsPage } from "./pages/artifacts";
import { CampaignsPage } from "./pages/campaigns";
import { ConversationsPage } from "./pages/conversations";
import { DashboardPage } from "./pages/dashboard";
import { InboxPage } from "./pages/inbox";
import { OnboardingPage } from "./pages/onboarding";
import { ProspectsPage } from "./pages/prospects";
import { SchedulePage } from "./pages/schedule";
import { AppearanceSettings } from "./pages/settings/appearance";
import { DiagnosticsSettings } from "./pages/settings/diagnostics";
import { EnvironmentSettings } from "./pages/settings/environment";
import { SettingsLayout } from "./pages/settings/layout";
import { MissionsSettings } from "./pages/settings/missions";
import { NotificationsSettings } from "./pages/settings/notifications";
import { ProfileSettings } from "./pages/settings/profile";
import { WorkspaceSettings } from "./pages/settings/workspace";
import { SignInScreen } from "./pages/sign-in";
import { TrendingPage } from "./pages/trending";
import { WorkspaceFilePage } from "./pages/workspace-file";
import { WorkspaceFilesPage } from "./pages/workspace-files";
import { CreateWorkspacePage } from "./pages/workspace-new";

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
  const { cloudOrganizationId } = useAuth();
  const { isAuthenticated: convexReady } = useConvexAuth();
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    // No reset here: keep the last onboarding decision mounted while the
    // fresh answer loads. Only the first resolution shows the entry state.
    const resolveOnboarding = async () => {
      try {
        const orgs = await listAuthOrganizations(false, { throwOnError: true });
        if (cancelled) return;
        const active =
          orgs.find((candidate) => candidate.id === cloudOrganizationId) ??
          orgs[0] ??
          null;
        if (!active) {
          setNeedsOnboarding(true);
          return;
        }
        const metadata = parseOrganizationMetadata(active);
        const onboarding =
          metadata.onboarding && typeof metadata.onboarding === "object"
            ? (metadata.onboarding as Record<string, unknown>)
            : {};
        setNeedsOnboarding(typeof onboarding.completedAt !== "string");
      } catch (error) {
        if (cancelled) return;
        console.warn("[Auth] Workspace metadata unavailable; retrying", error);
        // A server-issued active organization is enough to keep an existing
        // workspace usable while its metadata is revalidated in the background.
        if (cloudOrganizationId) setNeedsOnboarding(false);
        retryTimer = window.setTimeout(() => {
          void resolveOnboarding();
        }, 3_000);
      }
    };
    void resolveOnboarding();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [cloudOrganizationId]);

  useEffect(() => {
    const complete = () => setNeedsOnboarding(false);
    window.addEventListener("chief:onboarding-complete", complete);
    return () => {
      window.removeEventListener("chief:onboarding-complete", complete);
    };
  }, []);

  if (location.pathname === "/workspaces/new") {
    return children;
  }

  if (needsOnboarding === null || (cloudOrganizationId && !convexReady)) {
    return <EntryState />;
  }

  if (location.pathname === "/onboarding") {
    return needsOnboarding ? children : <Navigate to="/" replace />;
  }

  if (needsOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  return children;
}

class AppErrorBoundary extends Component<
  {
    children: ReactNode;
    onAuthenticationLost?: () => void;
    resetKey?: string;
  },
  { error: Error | null }
> {
  state = { error: null as Error | null };

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
        <BrowserRouter>
          <ChiefNavigationProvider>
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
                    <Route path="analytics" element={<AnalyticsPage />} />
                    <Route path="artifacts" element={<ArtifactsPage />} />
                    <Route path="campaigns" element={<CampaignsPage />} />
                    <Route path="schedule" element={<SchedulePage />} />
                    <Route path="prospects" element={<ProspectsPage />} />
                    <Route path="trending" element={<TrendingPage />} />
                    <Route
                      path="conversations"
                      element={<ConversationsPage />}
                    />
                    <Route path="agents" element={<AgentsPage />} />
                    <Route
                      path="projects/:projectId?"
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
                    <Route path="files" element={<WorkspaceFilesPage />} />
                    <Route
                      path="files/:fileId"
                      element={<WorkspaceFilePage />}
                    />
                    <Route path="settings" element={<SettingsLayout />}>
                      <Route
                        index
                        element={<Navigate to="/settings/profile" replace />}
                      />
                      <Route path="profile" element={<ProfileSettings />} />
                      <Route path="workspace" element={<WorkspaceSettings />} />
                      <Route path="missions" element={<MissionsSettings />} />
                      <Route
                        path="appearance"
                        element={<AppearanceSettings />}
                      />
                      <Route
                        path="notifications"
                        element={<NotificationsSettings />}
                      />
                      <Route
                        path="diagnostics"
                        element={<DiagnosticsSettings />}
                      />
                      <Route
                        path="environment"
                        element={<EnvironmentSettings />}
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
          </ChiefNavigationProvider>
        </BrowserRouter>
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
            <ConvexClientProvider>
              <AuthenticatedApp />
            </ConvexClientProvider>
          </AuthSessionBoundary>
        </AuthProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  );
}
