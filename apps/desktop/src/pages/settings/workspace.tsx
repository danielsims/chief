import { useCallback, useEffect, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@marketer/backend/convex/_generated/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@marketer/ui/components/card";
import { Button } from "@marketer/ui/components/button";
import { Input } from "@marketer/ui/components/input";
import { PrefixedInput } from "@marketer/ui/components/prefixed-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@marketer/ui/components/dialog";
import {
  faviconLoads,
  faviconUrl,
  OrgLogo,
} from "../../components/org-logo";
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

function LogoPreview({
  logo,
  website,
  name,
}: {
  logo: string | null | undefined;
  website: string;
  name: string;
}) {
  const src = logo || (website ? faviconUrl(website) : null);
  return (
    <OrgLogo
      name={name}
      logo={src}
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
            You'll be moved to another workspace, or signed out if this is
            your last one.
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
              This deletes the workspace and all of its data. Type the
              workspace name to confirm.
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
      const candidate = faviconUrl(website);
      const logo = candidate && (await faviconLoads(candidate)) ? candidate : undefined;
      const previousWebsite =
        typeof metadata.websiteUrl === "string" ? metadata.websiteUrl.trim() : "";
      const websiteChanged = previousWebsite !== website.trim();
      await updateAuthOrganization(org.id, {
        name: name.trim() || org.name,
        ...(websiteChanged ? { logo: logo ?? null } : logo ? { logo } : {}),
        metadata: { ...metadata, websiteUrl: website.trim() },
      });
      setOrg({
        ...org,
        name: name.trim() || org.name,
        logo: logo ?? (websiteChanged ? null : org.logo),
        metadata: { ...metadata, websiteUrl: website.trim() },
      });
      setSaveState("saved");
    } catch (error) {
      console.error("[Settings] Failed to save workspace:", error);
      setSaveState("error");
    } finally {
      setSaving(false);
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
            The company your agents work for. They use the name and website
            as context.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-4">
            <LogoPreview logo={org?.logo} website={website} name={name} />
            <p className="text-xs text-muted-foreground">
              The logo defaults to your website's favicon.
            </p>
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
