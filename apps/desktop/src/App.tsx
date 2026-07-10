import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { AuthProvider, useAuth } from "./lib/auth/auth-context";
import { ConvexClientProvider } from "./lib/convex";
import { RuntimeProvider } from "./lib/runtime";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
} from "./lib/auth/better-auth-client";
import { Layout } from "./components/layout";
import { DashboardPage } from "./pages/dashboard";
import { AnalyticsPage } from "./pages/analytics";
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

function OnboardingGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { cloudOrganizationId } = useAuth();
  const { isAuthenticated: convexReady } = useConvexAuth();
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  const subscription = useQuery(
    api.billing.getSubscription,
    convexReady && cloudOrganizationId ? {} : "skip",
  );

  useEffect(() => {
    let cancelled = false;
    setNeedsOnboarding(null);
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

  if (
    location.pathname === "/onboarding" ||
    location.pathname === "/workspaces/new"
  ) {
    return children;
  }

  if (needsOnboarding === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading workspace...
      </div>
    );
  }

  const billingLoading =
    Boolean(cloudOrganizationId) &&
    (!convexReady || subscription === undefined);

  if (billingLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Checking workspace access...
      </div>
    );
  }

  if (needsOnboarding || !hasWorkspaceAccess(subscription)) {
    return <Navigate to="/onboarding" replace />;
  }

  return children;
}

function AuthenticatedApp() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <SignInScreen />;
  }

  return (
    <RuntimeProvider>
      <BrowserRouter>
        <OnboardingGate>
          <Routes>
            <Route path="workspaces/new" element={<CreateWorkspacePage />} />
            <Route path="onboarding" element={<OnboardingPage />} />
            <Route element={<Layout />}>
              <Route index element={<DashboardPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
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
                <Route path="integrations" element={<IntegrationsSettings />} />
                <Route
                  path="integrations/:provider"
                  element={<IntegrationSettingsDetail />}
                />
              </Route>
            </Route>
          </Routes>
        </OnboardingGate>
      </BrowserRouter>
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
