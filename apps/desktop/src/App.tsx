import type { ErrorInfo, ReactNode } from "react";
import { Component, useEffect, useRef, useState } from "react";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { Toaster } from "sonner";

import { api } from "@chief/backend/convex/_generated/api";
import { Button } from "@chief/ui/components/button";

import { EntryState } from "./components/entry-state";
import { Layout } from "./components/layout";
import { AgentConfigProvider } from "./lib/agent-config";
import { AuthProvider, useAuth } from "./lib/auth/auth-context";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
} from "./lib/auth/better-auth-client";
import { hasWorkspaceAccess, openWorkspaceCheckout } from "./lib/billing";
import { missingDesktopConfiguration } from "./lib/config";
import { ConvexClientProvider } from "./lib/convex";
import { RuntimeProvider } from "./lib/runtime";
import { AgentsPage } from "./pages/agents";
import { AnalyticsPage } from "./pages/analytics";
import { CampaignsPage } from "./pages/campaigns";
import { ConversationsPage } from "./pages/conversations";
import { DashboardPage } from "./pages/dashboard";
import { OnboardingPage } from "./pages/onboarding";
import { ProspectsPage } from "./pages/prospects";
import { ResultsPage } from "./pages/results";
import { SchedulePage } from "./pages/schedule";
import {
  IntegrationSettingsDetail,
  IntegrationsSettings,
} from "./pages/settings/integrations";
import { SettingsLayout } from "./pages/settings/layout";
import { ProfileSettings } from "./pages/settings/profile";
import { WorkspaceSettings } from "./pages/settings/workspace";
import { SignInScreen } from "./pages/sign-in";
import { TrendingPage } from "./pages/trending";
import { CreateWorkspacePage } from "./pages/workspace-new";

function ConfigurationRequired() {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-6">
      <section className="bg-card w-full max-w-lg border p-8">
        <h1 className="font-serif text-3xl">Configure this build</h1>
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

function WorkspaceAccessRequired() {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openCheckout = async () => {
    setOpening(true);
    setError(null);
    const result = await openWorkspaceCheckout("monthly");
    if (result.status === "error") setError(result.message);
    if (result.status === "unavailable") {
      setError("Checkout is not available right now.");
    }
    setOpening(false);
  };

  return (
    <div className="bg-background text-foreground flex min-h-screen items-center justify-center px-6">
      <div className="bg-card w-full max-w-md border p-8 text-center">
        <h1 className="font-serif text-3xl">Continue with Chief</h1>
        <p className="text-muted-foreground mt-3 text-sm leading-6">
          Your workspace is already set up. Renew access to return to it.
        </p>
        <Button
          className="mt-6"
          onClick={() => void openCheckout()}
          disabled={opening}
        >
          {opening ? "Opening checkout..." : "Continue to checkout"}
        </Button>
        {error ? (
          <p className="text-destructive mt-3 text-xs">{error}</p>
        ) : null}
      </div>
    </div>
  );
}

function OnboardingGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { cloudOrganizationId } = useAuth();
  const { isAuthenticated: convexReady } = useConvexAuth();
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  const subscriptionQuery = useQuery(
    api.billing.getSubscription,
    // A cached Better Auth session can outlive its server-side session. Never
    // let an authenticated query race Convex's token confirmation: a rejected
    // query throws before the auth provider can return the user to sign-in.
    cloudOrganizationId && convexReady ? {} : "skip",
  );
  const reconcileSubscription = useAction(api.billing.reconcileSubscription);
  const reconciledWorkspaceRef = useRef<string | null>(null);
  // Latch the last resolved subscription so a re-subscribe (auth refresh,
  // org revalidation) revalidates behind the mounted app instead of tearing
  // the whole tree down to a loading screen. Convex pushes real status
  // changes reactively, so access enforcement stays server-driven.
  const [knownSubscription, setKnownSubscription] =
    useState<typeof subscriptionQuery>(undefined);
  useEffect(() => {
    if (subscriptionQuery !== undefined) {
      setKnownSubscription(subscriptionQuery);
    }
  }, [subscriptionQuery]);
  const subscription =
    subscriptionQuery === undefined ? knownSubscription : subscriptionQuery;

  useEffect(() => {
    if (!cloudOrganizationId || !convexReady) return;

    const reconcile = (sessionId?: string | null) => {
      void reconcileSubscription({
        ...(sessionId ? { sessionId } : {}),
      }).catch((error) => {
        console.warn("[Billing] Subscription reconciliation failed", error);
      });
    };
    const onBillingSuccess = (event: Event) => {
      // A new Checkout may complete after startup reconciliation, so always
      // run again when the browser returns through the desktop deep link.
      const detail = (event as CustomEvent<{ sessionId?: string | null }>)
        .detail;
      reconcile(detail?.sessionId);
    };

    window.addEventListener("chief:billing-success", onBillingSuccess);
    if (reconciledWorkspaceRef.current !== cloudOrganizationId) {
      reconciledWorkspaceRef.current = cloudOrganizationId;
      reconcile();
    }
    return () => {
      window.removeEventListener("chief:billing-success", onBillingSuccess);
    };
  }, [cloudOrganizationId, convexReady, reconcileSubscription]);

  useEffect(() => {
    let cancelled = false;
    // No reset here: keep the last onboarding decision mounted while the
    // fresh answer loads. Only the first resolution shows the entry state.
    void listAuthOrganizations().then((orgs) => {
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
    });
    return () => {
      cancelled = true;
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

  const billingLoading =
    Boolean(cloudOrganizationId) &&
    (!convexReady || subscription === undefined);

  if (needsOnboarding === null || billingLoading) {
    return <EntryState />;
  }

  if (location.pathname === "/onboarding") {
    return needsOnboarding ? children : <Navigate to="/" replace />;
  }

  if (needsOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  if (!hasWorkspaceAccess(subscription)) return <WorkspaceAccessRequired />;

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
        <section className="bg-card w-full max-w-md border p-8">
          <h1 className="font-serif text-3xl">Chief hit a problem</h1>
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

  if (isLoading) {
    return <EntryState />;
  }

  if (!isAuthenticated) {
    return <SignInScreen />;
  }

  return (
    <RuntimeProvider>
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{ style: { borderRadius: 0 } }}
      />
      <AgentConfigProvider>
        <BrowserRouter>
          <OnboardingGate>
            <Routes>
              <Route path="workspaces/new" element={<CreateWorkspacePage />} />
              <Route path="onboarding" element={<OnboardingPage />} />
              <Route element={<Layout />}>
                <Route index element={<DashboardPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
                <Route path="campaigns" element={<CampaignsPage />} />
                <Route path="schedule" element={<SchedulePage />} />
                <Route path="schedule/history" element={<ResultsPage />} />
                <Route path="prospects" element={<ProspectsPage />} />
                <Route path="trending" element={<TrendingPage />} />
                <Route path="conversations" element={<ConversationsPage />} />
                <Route path="agents" element={<AgentsPage />} />
                <Route path="settings" element={<SettingsLayout />}>
                  <Route
                    index
                    element={<Navigate to="/settings/profile" replace />}
                  />
                  <Route path="profile" element={<ProfileSettings />} />
                  <Route path="workspace" element={<WorkspaceSettings />} />
                  <Route
                    path="deployment"
                    element={<Navigate to="/agents" replace />}
                  />
                  <Route
                    path="integrations"
                    element={<IntegrationsSettings />}
                  />
                  <Route
                    path="integrations/:provider"
                    element={<IntegrationSettingsDetail />}
                  />
                </Route>
              </Route>
            </Routes>
          </OnboardingGate>
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
      <AuthProvider>
        <AuthSessionBoundary>
          <ConvexClientProvider>
            <AuthenticatedApp />
          </ConvexClientProvider>
        </AuthSessionBoundary>
      </AuthProvider>
    </AppErrorBoundary>
  );
}
