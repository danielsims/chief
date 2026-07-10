import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { AuthProvider, useAuth } from "./lib/auth/auth-context";
import { ConvexClientProvider } from "./lib/convex";
import { AgentConfigProvider } from "./lib/agent-config";
import { RuntimeProvider } from "./lib/runtime";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
} from "./lib/auth/better-auth-client";
import { Layout } from "./components/layout";
import { EntryState } from "./components/entry-state";
import { DashboardPage } from "./pages/dashboard";
import { AnalyticsPage } from "./pages/analytics";
import { CampaignsPage } from "./pages/campaigns";
import { SchedulePage } from "./pages/schedule";
import { AgentsPage } from "./pages/agents";
import { ConversationsPage } from "./pages/conversations";
import { ProspectsPage } from "./pages/prospects";
import { TrendingPage } from "./pages/trending";
import { SettingsLayout } from "./pages/settings/layout";
import { ProfileSettings } from "./pages/settings/profile";
import { WorkspaceSettings } from "./pages/settings/workspace";
import {
  IntegrationSettingsDetail,
  IntegrationsSettings,
} from "./pages/settings/integrations";
import { SignInScreen } from "./pages/sign-in";
import { CreateWorkspacePage } from "./pages/workspace-new";
import { OnboardingPage } from "./pages/onboarding";
import { useEffect, useState, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@marketer/backend/convex/_generated/api";
import { hasWorkspaceAccess } from "./lib/billing";
import { openWorkspaceCheckout } from "./lib/billing";
import { Button } from "@marketer/ui/components/button";

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
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md border bg-card p-8 text-center">
        <h1 className="font-serif text-3xl">Continue with Marketer</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
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
          <p className="mt-3 text-xs text-destructive">{error}</p>
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
    convexReady && cloudOrganizationId ? {} : "skip",
  );
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

function AuthenticatedApp() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <SignInScreen />;
  }

  return (
    <RuntimeProvider>
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
  return (
    <AuthProvider>
      <ConvexClientProvider>
        <AuthenticatedApp />
      </ConvexClientProvider>
    </AuthProvider>
  );
}
