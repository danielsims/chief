import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@marketer/backend/convex/_generated/api";
import { CheckCircle2, Circle } from "lucide-react";
import { useAuth } from "../lib/auth/auth-context";
import {
  listAuthOrganizations,
  parseOrganizationMetadata,
} from "../lib/auth/better-auth-client";

interface SetupItem {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  /** Onboarding step to resume at when not done. */
  step: string;
}

/**
 * Anything skipped during onboarding stays visible here until it's handled.
 * Each open item resumes the same agent-guided setup at the right step, so
 * finishing your account is the same experience as onboarding was.
 */
export function SetupProgress() {
  const navigate = useNavigate();
  const { cloudOrganizationId } = useAuth();
  const { isAuthenticated: convexReady } = useConvexAuth();
  const channels = useQuery(
    api.integrations.listConnected,
    convexReady && cloudOrganizationId ? {} : "skip",
  );
  const [onboarding, setOnboarding] = useState<Record<string, unknown> | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void listAuthOrganizations().then((orgs) => {
      if (cancelled) return;
      const org =
        orgs.find((candidate) => candidate.id === cloudOrganizationId) ??
        orgs[0];
      if (!org) return;
      const metadata = parseOrganizationMetadata(org);
      setOnboarding(
        metadata.onboarding && typeof metadata.onboarding === "object"
          ? (metadata.onboarding as Record<string, unknown>)
          : {},
      );
    });
    return () => {
      cancelled = true;
    };
  }, [cloudOrganizationId]);

  if (!onboarding || channels === undefined) return null;

  const ads =
    onboarding.ads && typeof onboarding.ads === "object"
      ? (onboarding.ads as Record<string, unknown>)
      : {};
  const analyticsConnected = channels.some(
    (channel) => channel.category === "analytics",
  );
  const adsConnected = channels.some((channel) => channel.category === "ads");
  const adsBudgetPlanned =
    typeof ads.budget === "string" && ads.budget !== "No budget yet";

  const items: SetupItem[] = [
    {
      key: "analytics",
      label: "Analytics",
      detail: analyticsConnected
        ? "Connected"
        : "Connect a source so your agents can read real numbers",
      done: analyticsConnected,
      step: "analytics",
    },
    {
      key: "ads",
      label: "Ads",
      detail: adsConnected
        ? "Connected"
        : adsBudgetPlanned
          ? `Budget planned: ${String(ads.budget)}`
          : "Connect an ads account or set a budget for agent-run ads",
      done: adsConnected || adsBudgetPlanned,
      step: "ads",
    },
  ];

  const doneCount = items.filter((item) => item.done).length;
  if (doneCount === items.length) return null;

  return (
    <div className="border bg-card">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <p className="text-sm font-medium">Finish setting up</p>
        <p className="text-xs text-muted-foreground">
          {Math.round((doneCount / items.length) * 100)}% complete
        </p>
      </div>
      <div className="divide-y">
        {items.map((item) => (
          <div key={item.key} className="flex items-center gap-3 px-5 py-3">
            {item.done ? (
              <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
            ) : (
              <Circle size={15} className="shrink-0 text-muted-foreground/50" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{item.label}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {item.detail}
              </span>
            </span>
            {!item.done ? (
              <button
                type="button"
                onClick={() => navigate(`/onboarding?step=${item.step}`)}
                className="shrink-0 cursor-pointer text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                Set up
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
