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
import { createChat } from "../lib/chat-log";

interface SetupItem {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  action: "analytics" | "ads";
}

/** Resolved card state: null means "everything done, render nothing". */
interface SetupSnapshot {
  items: SetupItem[];
  doneCount: number;
  adsBudget: string | null;
}

const SNAPSHOT_KEY = "marketer-setup-progress";

function snapshotKey(workspaceId: string) {
  return `${SNAPSHOT_KEY}:${workspaceId}`;
}

/**
 * The last resolved decision, persisted so the card holds its place in the
 * dashboard's first frame instead of popping in after two network round
 * trips and shoving every card down.
 */
function readSnapshot(
  workspaceId: string | null,
): SetupSnapshot | null | undefined {
  if (!workspaceId) return undefined;
  const raw = localStorage.getItem(snapshotKey(workspaceId));
  if (raw === null) return undefined;
  if (raw === "hidden") return null;
  try {
    return JSON.parse(raw) as SetupSnapshot;
  } catch {
    return undefined;
  }
}

function writeSnapshot(workspaceId: string, snapshot: SetupSnapshot | null) {
  localStorage.setItem(
    snapshotKey(workspaceId),
    snapshot === null ? "hidden" : JSON.stringify(snapshot),
  );
}

/**
 * Anything skipped during onboarding stays visible here until it's handled.
 * Completed onboarding is immutable. Open items route to their normal app
 * surface or a specialist conversation instead of reopening onboarding.
 */
export function SetupProgress({
  onVisibilityChange,
}: {
  onVisibilityChange?: (visible: boolean) => void;
} = {}) {
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
  const [snapshot, setSnapshot] = useState<SetupSnapshot | null | undefined>(
    () => readSnapshot(cloudOrganizationId),
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

  // Recompute once both sources resolve; persist so the next dashboard
  // visit renders the same decision synchronously and revalidates in place.
  useEffect(() => {
    if (!cloudOrganizationId || !onboarding || channels === undefined) return;
    const ads =
      onboarding.ads && typeof onboarding.ads === "object"
        ? (onboarding.ads as Record<string, unknown>)
        : {};
    const analyticsConnected = channels.some(
      (channel) => channel.category === "analytics",
    );
    const adsConnected = channels.some(
      (channel) => channel.category === "ads",
    );
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
        action: "analytics",
      },
      {
        key: "ads",
        label: "Ads",
        detail: adsConnected
          ? "Connected"
          : adsBudgetPlanned
            ? `Budget planned: ${String(ads.budget)}`
            : "Connect an ads account or set a budget for agent-run ads",
        done: adsConnected,
        action: "ads",
      },
    ];
    const doneCount = items.filter((item) => item.done).length;
    const next: SetupSnapshot | null =
      doneCount === items.length
        ? null
        : {
            items,
            doneCount,
            adsBudget: adsBudgetPlanned ? String(ads.budget) : null,
          };
    writeSnapshot(cloudOrganizationId, next);
    setSnapshot(next);
  }, [cloudOrganizationId, onboarding, channels]);

  useEffect(() => {
    onVisibilityChange?.(Boolean(snapshot));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  if (!snapshot) return null;

  const startSetup = (item: SetupItem) => {
    if (item.action === "analytics") {
      navigate("/analytics");
      return;
    }
    const conversation = createChat("ads", "Set up paid campaigns");
    const budget = snapshot.adsBudget ?? "a small test budget";
    const draft = `Help me set up my first paid campaign with ${budget}. Start by checking what ad accounts are connected, then guide me through the cleanest next step.`;
    navigate(
      `/conversations?agent=ads&chat=${conversation.id}&new=1&draft=${encodeURIComponent(draft)}`,
    );
  };

  return (
    <div className="border bg-card">
      <div className="flex items-center justify-between border-b px-5 py-3">
        <p className="text-sm font-medium">Finish setting up</p>
        <p className="text-xs text-muted-foreground">
          {Math.round((snapshot.doneCount / snapshot.items.length) * 100)}%
          complete
        </p>
      </div>
      <div className="divide-y">
        {snapshot.items.map((item) => (
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
                onClick={() => startSetup(item)}
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
