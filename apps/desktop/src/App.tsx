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
import { AgentsPage } from "./pages/agents";
import { ConversationsPage } from "./pages/conversations";
import { SettingsLayout } from "./pages/settings/layout";
import { ProfileSettings } from "./pages/settings/profile";
import { WorkspaceSettings } from "./pages/settings/workspace";
import { SignInScreen } from "./pages/sign-in";
import { CreateWorkspacePage } from "./pages/workspace-new";
import { OnboardingPage } from "./pages/onboarding";
import { PlaceholderPage } from "./pages/placeholder";
import { useEffect, useState, type ReactNode } from "react";

function OnboardingGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { cloudOrganizationId } = useAuth();
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);

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
        setNeedsOnboarding(false);
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

  if (needsOnboarding) return <Navigate to="/onboarding" replace />;

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
              <Route
                path="analytics"
                element={
                  <PlaceholderPage
                    title="Analytics"
                    description="Traffic, signups and campaign performance from Google Analytics and Google Ads."
                  />
                }
              />
              <Route
                path="schedule"
                element={
                  <PlaceholderPage
                    title="Schedule"
                    description="Drafts queued for publishing across your channels."
                  />
                }
              />
              <Route
                path="prospects"
                element={
                  <PlaceholderPage
                    title="Prospects"
                    description="People and conversations your prospector agent found."
                  />
                }
              />
              <Route
                path="trending"
                element={
                  <PlaceholderPage
                    title="Trending"
                    description="Trending posts and topics across your connected channels."
                  />
                }
              />
              <Route path="conversations" element={<ConversationsPage />} />
              <Route path="agents" element={<AgentsPage />} />
              <Route path="settings" element={<SettingsLayout />}>
                <Route
                  index
                  element={<Navigate to="/settings/profile" replace />}
                />
                <Route path="profile" element={<ProfileSettings />} />
                <Route path="workspace" element={<WorkspaceSettings />} />
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
