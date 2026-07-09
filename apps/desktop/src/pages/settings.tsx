import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@marketer/ui/components/card";
import { Button } from "@marketer/ui/components/button";
import { useAuth } from "../lib/auth/auth-context";

const integrations = [
  { name: "Google Analytics", detail: "Website traffic, signups, funnels" },
  { name: "Google Ads", detail: "Campaign performance and spend" },
  { name: "X (Twitter)", detail: "Posts, engagement, trends" },
  { name: "Reddit", detail: "Communities and conversations" },
  { name: "LinkedIn", detail: "Company page content" },
  { name: "Instagram", detail: "Posts and reels" },
  { name: "TikTok", detail: "Video content performance" },
];

function AccountCard() {
  const { isAuthenticated, isSigningIn, user, cloudOrganizationId, signIn, signOut } =
    useAuth();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>
          Sign in to sync agents, schedules and telemetry with your cloud
          workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isAuthenticated && user ? (
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium">{user.email}</p>
              <p className="text-xs text-muted-foreground">
                {cloudOrganizationId
                  ? `Organization: ${cloudOrganizationId}`
                  : "No organization"}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium">Not signed in</p>
              <p className="text-xs text-muted-foreground">
                Opens your browser to authenticate.
              </p>
            </div>
            <Button size="sm" onClick={signIn} disabled={isSigningIn}>
              {isSigningIn ? "Waiting for browser..." : "Sign in"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 pt-10">
      <div>
        <h1 className="font-serif text-3xl">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect the channels your agents can see and act on.
        </p>
      </div>
      <AccountCard />
      <Card>
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>
            OAuth connections are handled locally. Nothing leaves your
            machine.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {integrations.map((i) => (
            <div key={i.name} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium">{i.name}</p>
                <p className="text-xs text-muted-foreground">{i.detail}</p>
              </div>
              <Button variant="outline" size="sm" disabled>
                Connect
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
