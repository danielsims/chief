import { useState } from "react";

import { isJsonObject } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chief/ui/components/card";

import type { AuthOrganization } from "../lib/auth/better-auth-client";
import {
  parseOrganizationMetadata,
  updateAuthOrganization,
} from "../lib/auth/better-auth-client";

/**
 * Development-only onboarding replay control.
 *
 * This entire module is loaded behind `import.meta.env.DEV` in Workspace
 * settings. It is deliberately isolated so it cannot become a production
 * product surface and can be removed as one file when onboarding stabilizes.
 */
export function DevelopmentOnboardingReplay({
  organization,
}: {
  organization: AuthOrganization;
}) {
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restart = async () => {
    setRestarting(true);
    setError(null);
    try {
      const metadata = parseOrganizationMetadata(organization);
      const savedOnboarding =
        metadata.onboarding && isJsonObject(metadata.onboarding)
          ? { ...(metadata.onboarding as Record<string, unknown>) }
          : {};
      delete savedOnboarding.completedAt;
      await updateAuthOrganization(organization.id, {
        metadata: { ...metadata, onboarding: savedOnboarding },
      });
      // A reload makes the normal onboarding gate re-read authoritative org
      // metadata. The existing answers stay in metadata and prefill the form.
      window.location.assign("/onboarding");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setRestarting(false);
    }
  };

  return (
    <Card className="border-blue-400/35">
      <CardHeader>
        <CardTitle>Development onboarding replay</CardTitle>
        <CardDescription>
          Restart onboarding with this workspace’s saved answers. Workspace data
          is not deleted.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-xs">
          Development builds only. This control is removed from production.
        </p>
        <Button
          disabled={restarting}
          onClick={() => void restart()}
          size="sm"
          type="button"
          variant="outline"
        >
          {restarting ? "Restarting…" : "Restart onboarding"}
        </Button>
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
