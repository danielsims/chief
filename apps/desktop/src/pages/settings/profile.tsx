import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@marketer/ui/components/card";
import { Button } from "@marketer/ui/components/button";
import { Input } from "@marketer/ui/components/input";
import { useAuth } from "../../lib/auth/auth-context";

export function ProfileSettings() {
  const { isAuthenticated, isSigningIn, user, signIn, signOut } = useAuth();

  if (!isAuthenticated || !user) {
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
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>
          Your account details come from your sign-in provider.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden border bg-background">
            {user.image ? (
              <img
                src={user.image}
                alt={user.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="font-serif text-lg">
                {(user.name || user.email).charAt(0).toUpperCase()}
              </span>
            )}
          </span>
          <div>
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted-foreground">
              {user.emailVerified ? "Verified" : "Unverified"}
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="profile-name">
            Name
          </label>
          <Input id="profile-name" value={user.name} readOnly />
        </div>
        <div className="space-y-1.5">
          <label
            className="text-xs text-muted-foreground"
            htmlFor="profile-email"
          >
            Email
          </label>
          <Input id="profile-email" value={user.email} readOnly />
        </div>
        <div className="flex items-center justify-between border-t pt-4">
          <p className="text-xs text-muted-foreground">
            Signing out keeps your local data on this machine.
          </p>
          <Button variant="outline" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
