import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chief/ui/components/card";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import { useAuth } from "../../lib/auth/auth-context";
import { removeImageAsset, uploadImageAsset } from "../../lib/image-upload";

export function ProfileSettings() {
  const {
    isAuthenticated,
    isSigningIn,
    user,
    signIn,
    signOut,
    updateProfileImage,
  } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const uploadImage = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setImageError(null);
    try {
      await updateProfileImage(await uploadImageAsset(file, "profile"));
    } catch (error) {
      setImageError(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  };

  const removeImage = async () => {
    setUploading(true);
    setImageError(null);
    try {
      await updateProfileImage(null);
      await removeImageAsset("profile");
    } catch (error) {
      setImageError(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  };

  if (!isAuthenticated || !user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            Sign in to sync your workspace across devices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between py-3">
            <div>
              <p className="text-sm font-medium">Not signed in</p>
              <p className="text-xs text-muted-foreground">
                Sign-in opens in your browser.
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
          Your name and email come from your sign-in provider. Your profile
          image can be changed here.
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
              <span className="translate-y-[0.055em] font-serif text-lg leading-none">
                {(user.name || user.email).charAt(0).toUpperCase()}
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted-foreground">
              {user.emailVerified ? "Verified" : "Unverified"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <label className="cursor-pointer">
                  {uploading ? "Processing..." : "Upload image"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading}
                    onChange={(event) => {
                      void uploadImage(event.target.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </Button>
              {user.image ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={uploading}
                  onClick={() => void removeImage()}
                >
                  Remove
                </Button>
              ) : null}
            </div>
            {imageError ? (
              <p className="mt-2 text-xs text-destructive">{imageError}</p>
            ) : null}
          </div>
        </div>
        <div className="space-y-1.5">
          <label
            className="text-xs text-muted-foreground"
            htmlFor="profile-name"
          >
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
            Signing out keeps local data on this machine.
          </p>
          <Button variant="outline" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
