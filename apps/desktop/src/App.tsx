import { BrowserRouter, Route, Routes } from "react-router";
import { AuthProvider, useAuth } from "./lib/auth/auth-context";
import { RuntimeProvider } from "./lib/runtime";
import { Layout } from "./components/layout";
import { DashboardPage } from "./pages/dashboard";
import { AgentsPage } from "./pages/agents";
import { SettingsPage } from "./pages/settings";
import { SignInScreen } from "./pages/sign-in";
import { PlaceholderPage } from "./pages/placeholder";

function AuthenticatedApp() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <SignInScreen />;
  }

  return (
    <RuntimeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route
              path="analytics"
              element={
                <PlaceholderPage
                  title="Analytics"
                  description="Website traffic, signups, SEO, CAC/LTV, funnel falloff, pulled from Google Analytics and Google Ads."
                />
              }
            />
            <Route
              path="schedule"
              element={
                <PlaceholderPage
                  title="Schedule"
                  description="Drafted content queued for publishing across your channels."
                />
              }
            />
            <Route
              path="prospects"
              element={
                <PlaceholderPage
                  title="Prospects"
                  description="People and conversations worth your attention, found by your prospector agent."
                />
              }
            />
            <Route
              path="trending"
              element={
                <PlaceholderPage
                  title="Trending"
                  description="Trending posts and topics across X, Reddit and other connected channels."
                />
              }
            />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </RuntimeProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}
