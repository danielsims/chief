import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import type { RelayClient } from "@chief/relay-client";
import type {
  WorkspaceInvitation,
  WorkspaceInviteLink,
  WorkspaceMember,
} from "@chief/relay-contracts";
import { isJsonString } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chief/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { Input } from "@chief/ui/components/input";
import { Skeleton } from "@chief/ui/components/skeleton";

import type { AuthOrganization } from "../../lib/auth/better-auth-client";
import { OrgLogo, resolveFaviconUrl } from "../../components/org-logo";
import { WorkspaceInvitationsCard } from "../../components/workspace-invitations-card";
import { WorkspaceMembersCard } from "../../components/workspace-members-card";
import { useAuth } from "../../lib/auth/auth-context";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
  updateAuthOrganization,
} from "../../lib/auth/better-auth-client";
import {
  canManageChannels,
  workspaceRoleForUser,
} from "../../lib/auth/organization-role";
import { removeImageAsset, uploadImageAsset } from "../../lib/image-upload";
import { useRelaySession } from "../../lib/relay-session";

// Vite removes this development-only replay import from production releases.
const DevelopmentOnboardingReplay = import.meta.hot
  ? lazy(() =>
      import("../../dev/onboarding-replay-card").then((module) => ({
        default: module.DevelopmentOnboardingReplay,
      })),
    )
  : null;

interface WorkspaceDirectory {
  members: WorkspaceMember[];
  invitations: WorkspaceInvitation[];
  inviteLinks: WorkspaceInviteLink[];
  membersError: string | null;
  invitationsError: string | null;
}

async function settle<T>(
  promise: Promise<T[]>,
  fallback: string,
): Promise<{ value: T[]; error: string | null }> {
  try {
    return { value: await promise, error: null };
  } catch (error) {
    return {
      value: [],
      error: error instanceof Error ? error.message : fallback,
    };
  }
}

/**
 * Loads everything the members and invitations cards need in one pass so the
 * page can render its cards together instead of popping them in one by one.
 */
async function loadWorkspaceDirectory(
  client: RelayClient,
): Promise<WorkspaceDirectory> {
  const [members, invitations, inviteLinks] = await Promise.all([
    settle(
      client.listWorkspaceMembers(),
      "Chief couldn’t load this workspace’s members.",
    ),
    settle(
      client.listWorkspaceInvitations(),
      "Chief couldn’t load pending invitations.",
    ),
    settle(client.listWorkspaceInvites(), "Chief couldn’t load invite links."),
  ]);
  return {
    members: members.value,
    membersError: members.error,
    invitations: invitations.value,
    invitationsError: invitations.error ?? inviteLinks.error,
    inviteLinks: inviteLinks.value,
  };
}

function LogoPreview({
  logo,
  website,
  name,
}: {
  logo: string | null | undefined;
  website: string;
  name: string;
}) {
  return (
    <OrgLogo
      name={name}
      logo={logo}
      website={website}
      className="h-12 w-12 shrink-0 text-lg"
      imgClassName="h-8 w-8 object-contain"
      transparentWhenLoaded
    />
  );
}

function DeleteWorkspaceCard({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const { deleteWorkspace } = useRelaySession();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteWorkspace(workspaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Delete workspace</CardTitle>
        <CardDescription>
          Permanently delete this workspace and all of its data.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between py-1">
          <p className="text-muted-foreground text-xs">
            You'll be moved to another workspace, or signed out if this is your
            last one.
          </p>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setConfirmation("");
              setError(null);
              setOpen(true);
            }}
          >
            Delete workspace
          </Button>
        </div>
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {workspaceName}</DialogTitle>
            <DialogDescription>
              This deletes the workspace and all of its data. Type the workspace
              name to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={workspaceName}
          />
          {error && <p className="text-destructive text-xs">{error}</p>}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={confirmation !== workspaceName || deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? "Deleting..." : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * Placeholder shown while the page resolves its organization and workspace
 * directory. The cards below occupy the same slots once ready, so nothing pops
 * in after the first paint.
 */
function WorkspaceSettingsSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-12 rounded-full" />
            <Skeleton className="h-8 w-36" />
          </div>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <div className="flex justify-end border-t pt-4">
            <Skeleton className="h-8 w-20" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

export function WorkspaceSettings() {
  const { client, snapshot } = useRelaySession();
  const { cloudOrganizationId, user } = useAuth();
  const userId = user?.id;

  const [org, setOrg] = useState<AuthOrganization | null>(null);
  const [orgLoaded, setOrgLoaded] = useState(false);
  const [directory, setDirectory] = useState<WorkspaceDirectory | null>(null);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [logoSource, setLogoSource] = useState<"favicon" | "upload">("favicon");
  const [processingLogo, setProcessingLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">(
    "idle",
  );

  useEffect(() => {
    let cancelled = false;
    void listAuthOrganizations()
      .then((orgs) => {
        if (cancelled) return;
        const active =
          orgs.find((candidate) => candidate.id === cloudOrganizationId) ??
          orgs[0] ??
          null;
        setOrg(active);
        if (active) {
          setName(active.name);
          const metadata = parseOrganizationMetadata(active);
          setWebsite(
            isJsonString(metadata.websiteUrl) ? metadata.websiteUrl : "",
          );
          setLogo(active.logo ?? null);
          setLogoSource(
            metadata.logoSource === "upload" ? "upload" : "favicon",
          );
        }
      })
      .catch((error: unknown) => {
        console.warn("[Workspace] Could not load the organization:", error);
      })
      .finally(() => {
        if (!cancelled) setOrgLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [cloudOrganizationId]);

  const refreshDirectory = useCallback(async () => {
    if (!client) return;
    setDirectory(await loadWorkspaceDirectory(client));
  }, [client]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void loadWorkspaceDirectory(client).then((next) => {
      if (!cancelled) setDirectory(next);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const handleSave = async () => {
    if (!org) return;
    setSaving(true);
    setSaveState("idle");
    try {
      const metadata = parseOrganizationMetadata(org);
      const nextLogo =
        logoSource === "upload"
          ? logo
          : await resolveFaviconUrl(website.trim());
      await updateAuthOrganization(org.id, {
        name: name.trim() || org.name,
        logo: nextLogo,
        metadata: {
          ...metadata,
          websiteUrl: website.trim(),
          logoSource:
            logoSource === "upload" && nextLogo ? "upload" : "favicon",
        },
      });
      setOrg({
        ...org,
        name: name.trim() || org.name,
        logo: nextLogo,
        metadata: {
          ...metadata,
          websiteUrl: website.trim(),
          logoSource:
            logoSource === "upload" && nextLogo ? "upload" : "favicon",
        },
      });
      setLogo(nextLogo);
      setSaveState("saved");
    } catch (error) {
      console.error("[Settings] Failed to save workspace:", error);
      setSaveState("error");
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    setProcessingLogo(true);
    setLogoError(null);
    try {
      if (!org) return;
      if (!client) throw new Error("Chief is not connected to the relay.");
      const nextLogo = await uploadImageAsset(file, "workspace", client);
      const metadata = parseOrganizationMetadata(org);
      await updateAuthOrganization(org.id, {
        logo: nextLogo,
        metadata: { ...metadata, logoSource: "upload" },
      });
      setOrg({
        ...org,
        logo: nextLogo,
        metadata: { ...metadata, logoSource: "upload" },
      });
      setLogo(nextLogo);
      setLogoSource("upload");
      setSaveState("saved");
    } catch (error) {
      setLogoError(error instanceof Error ? error.message : String(error));
    } finally {
      setProcessingLogo(false);
    }
  };

  const applyWebsiteIcon = async () => {
    if (!org) return;
    setProcessingLogo(true);
    setLogoError(null);
    try {
      const nextLogo = await resolveFaviconUrl(website.trim());
      const metadata = parseOrganizationMetadata(org);
      await updateAuthOrganization(org.id, {
        logo: nextLogo,
        metadata: { ...metadata, logoSource: "favicon" },
      });
      if (client) await removeImageAsset("workspace", client);
      setOrg({
        ...org,
        logo: nextLogo,
        metadata: { ...metadata, logoSource: "favicon" },
      });
      setLogo(nextLogo);
      setLogoSource("favicon");
      setSaveState("saved");
    } catch (error) {
      setLogoError(error instanceof Error ? error.message : String(error));
    } finally {
      setProcessingLogo(false);
    }
  };

  if (!orgLoaded || !client || !snapshot || !directory) {
    return <WorkspaceSettingsSkeleton />;
  }

  const viewerRole = workspaceRoleForUser(directory.members, userId);
  const canManage = canManageChannels(viewerRole);
  const canDeleteWorkspace = viewerRole === "owner";
  const workspaceName = snapshot.name;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>
            The company your agents work for. They use the name and website as
            context.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-4">
            <LogoPreview logo={logo} website={website} name={name} />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  render={<label className="cursor-pointer" />}
                  variant="outline"
                  size="sm"
                >
                  {processingLogo ? "Processing..." : "Upload image"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={processingLogo || !org}
                    onChange={(event) => {
                      void uploadLogo(event.target.files?.[0]);
                      event.currentTarget.value = "";
                    }}
                  />
                </Button>
                {logoSource === "upload" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={processingLogo}
                    onClick={() => void applyWebsiteIcon()}
                  >
                    Use website icon
                  </Button>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                Upload an image to override the website favicon.
              </p>
              {logoError ? (
                <p className="text-destructive mt-1 text-xs">{logoError}</p>
              ) : null}
            </div>
          </div>
          <div className="space-y-1.5">
            <label
              className="text-muted-foreground text-xs"
              htmlFor="workspace-name"
            >
              Company name
            </label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Inc"
              disabled={!org}
            />
          </div>
          <div className="space-y-1.5">
            <label
              className="text-muted-foreground text-xs"
              htmlFor="workspace-website"
            >
              Website URL
            </label>
            <Input
              id="workspace-website"
              value={website}
              onChange={(event) => setWebsite(event.target.value)}
              placeholder="https://acme.com"
              disabled={!org}
            />
          </div>
          <div className="flex items-center justify-end gap-3 border-t pt-4">
            {saveState === "saved" && (
              <span className="text-muted-foreground text-xs">Saved</span>
            )}
            {saveState === "error" && (
              <span className="text-destructive text-xs">Save failed</span>
            )}
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={!org || saving}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {org && DevelopmentOnboardingReplay ? (
        <Suspense fallback={null}>
          <DevelopmentOnboardingReplay organization={org} />
        </Suspense>
      ) : null}

      <WorkspaceMembersCard
        members={directory.members}
        error={directory.membersError}
        workspaceName={workspaceName}
        canManage={canManage}
        currentUserId={userId}
        onChanged={refreshDirectory}
      />

      {canManage ? (
        <WorkspaceInvitationsCard
          workspaceId={snapshot.id}
          workspaceName={workspaceName}
          invitations={directory.invitations}
          links={directory.inviteLinks}
          error={directory.invitationsError}
          onChanged={refreshDirectory}
        />
      ) : null}

      {canDeleteWorkspace ? (
        <DeleteWorkspaceCard
          workspaceId={snapshot.id}
          workspaceName={workspaceName}
        />
      ) : null}
    </>
  );
}
