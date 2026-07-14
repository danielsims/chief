import { useCallback, useEffect, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@chief/backend/convex/_generated/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chief/ui/components/card";
import { Button } from "@chief/ui/components/button";
import { Input } from "@chief/ui/components/input";
import { PrefixedInput } from "@chief/ui/components/prefixed-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { OrgLogo, resolveFaviconUrl } from "../../components/org-logo";
import { useAuth } from "../../lib/auth/auth-context";
import {
  type AuthOrganization,
  deleteAuthOrganization,
  listAuthOrganizations,
  parseOrganizationMetadata,
  setActiveAuthOrganization,
  updateAuthOrganization,
} from "../../lib/auth/better-auth-client";
import {
  SOCIAL_PLATFORMS,
  type SocialPlatformDef,
} from "../../lib/social-platforms";
import { removeImageAsset, uploadImageAsset } from "../../lib/image-upload";

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
    />
  );
}

function SocialAccountRow({
  def,
  savedHandle,
  ready,
}: {
  def: SocialPlatformDef;
  savedHandle: string;
  ready: boolean;
}) {
  const upsert = useMutation(api.socialAccounts.upsert);
  const removeAccount = useMutation(api.socialAccounts.remove);
  const [value, setValue] = useState(savedHandle);

  useEffect(() => {
    setValue(savedHandle);
  }, [savedHandle]);

  const commit = useCallback(async () => {
    if (value === savedHandle) return;
    try {
      if (value) {
        await upsert({ platform: def.platform, handle: value });
      } else {
        await removeAccount({ platform: def.platform });
      }
    } catch (error) {
      console.error(`[Settings] Failed to save ${def.label} handle:`, error);
      setValue(savedHandle);
    }
  }, [value, savedHandle, upsert, removeAccount, def]);

  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">
        {def.label}
      </span>
      <PrefixedInput
        prefix={def.prefix}
        value={value}
        onValueChange={setValue}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        placeholder="handle"
        disabled={!ready}
      />
    </div>
  );
}

function DeleteWorkspaceCard({ org }: { org: AuthOrganization }) {
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteAuthOrganization(org.id);
      const remaining = (await listAuthOrganizations()).filter(
        (candidate) => candidate.id !== org.id,
      );
      if (remaining.length > 0) {
        await setActiveAuthOrganization(remaining[0].id);
        window.location.assign("/");
      } else {
        signOut();
      }
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
          <p className="text-xs text-muted-foreground">
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
            <DialogTitle>Delete {org.name}</DialogTitle>
            <DialogDescription>
              This deletes the workspace and all of its data. Type the workspace
              name to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={org.name}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={confirmation !== org.name || deleting}
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

export function WorkspaceSettings() {
  const { cloudOrganizationId } = useAuth();
  const { isAuthenticated: convexReady } = useConvexAuth();
  const socialAccounts = useQuery(
    api.socialAccounts.list,
    convexReady ? {} : "skip",
  );

  const [org, setOrg] = useState<AuthOrganization | null>(null);
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
    void listAuthOrganizations().then((orgs) => {
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
          typeof metadata.websiteUrl === "string" ? metadata.websiteUrl : "",
        );
        setLogo(active.logo ?? null);
        setLogoSource(metadata.logoSource === "upload" ? "upload" : "favicon");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [cloudOrganizationId]);

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
      const nextLogo = await uploadImageAsset(file, "workspace");
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

  const useWebsiteIcon = async () => {
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
      await removeImageAsset("workspace");
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

  const savedHandles = new Map(
    (socialAccounts ?? []).map((account) => [account.platform, account.handle]),
  );

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
                <Button asChild variant="outline" size="sm">
                  <label className="cursor-pointer">
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
                  </label>
                </Button>
                {logoSource === "upload" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={processingLogo}
                    onClick={() => void useWebsiteIcon()}
                  >
                    Use website icon
                  </Button>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Upload an image to override the website favicon.
              </p>
              {logoError ? (
                <p className="mt-1 text-xs text-destructive">{logoError}</p>
              ) : null}
            </div>
          </div>
          <div className="space-y-1.5">
            <label
              className="text-xs text-muted-foreground"
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
              className="text-xs text-muted-foreground"
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
              <span className="text-xs text-muted-foreground">Saved</span>
            )}
            {saveState === "error" && (
              <span className="text-xs text-destructive">Save failed</span>
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

      <Card>
        <CardHeader>
          <CardTitle>Social accounts</CardTitle>
          <CardDescription>
            Add the social accounts your agents write for.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {SOCIAL_PLATFORMS.map((def) => (
            <SocialAccountRow
              key={def.platform}
              def={def}
              savedHandle={savedHandles.get(def.platform) ?? ""}
              ready={convexReady && socialAccounts !== undefined}
            />
          ))}
          {!convexReady && (
            <p className="text-xs text-muted-foreground">
              Connecting to your workspace…
            </p>
          )}
        </CardContent>
      </Card>

      {org && <DeleteWorkspaceCard org={org} />}
    </>
  );
}
