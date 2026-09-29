import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";

import type { ActionItem } from "@chief/agent-runtime/types";
import { isJsonString } from "@chief/relay-contracts";
import { MatrixLoader } from "@chief/ui/components/matrix-loader";
import { cn } from "@chief/ui/lib/utils";

import type { AuthOrganization } from "../lib/auth/better-auth-client";
import { parseOrganizationMetadata } from "../lib/auth/better-auth-client";
import { OrgLogo } from "./org-logo";
import { Shimmer } from "./ui/shimmer";

export const overviewButton =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3.5 text-[12px] font-medium transition-colors shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_12%,transparent),inset_0_1px_0_rgba(255,255,255,0.05)] hover:bg-accent";

export interface OverviewAction {
  id: string;
  title: string;
  agentId: string;
  action?: ActionItem;
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: value > 9999 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function WorkspaceIndicator({
  organization,
}: {
  organization: AuthOrganization | null;
}) {
  if (!organization) return <span className="min-h-7" />;
  const metadata = parseOrganizationMetadata(organization);
  return (
    <div className="text-muted-foreground flex min-h-7 items-center gap-2 text-[11px]">
      <OrgLogo
        name={organization.name}
        logo={organization.logo}
        website={isJsonString(metadata.websiteUrl) ? metadata.websiteUrl : ""}
        className="size-6 shrink-0 text-xs"
        transparentWhenLoaded
      />
      <span>{organization.name}</span>
    </div>
  );
}

export function OverviewActionPagination({
  actions,
  index,
  onMove,
  className,
}: {
  actions: OverviewAction[];
  index: number;
  onMove: (direction: number) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        aria-label="Previous action item"
        onClick={() => onMove(-1)}
        type="button"
        className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md transition-colors hover:bg-black/[0.035] dark:hover:bg-white/[0.05]"
      >
        <ChevronLeft size={14} />
      </button>
      <span aria-hidden="true" className="flex items-center gap-1">
        {actions.map((item, itemIndex) => (
          <i
            className={cn(
              "bg-border block h-0.5 w-3 rounded-full",
              itemIndex === index && "bg-foreground",
            )}
            key={item.id}
          />
        ))}
      </span>
      <button
        aria-label="Next action item"
        onClick={() => onMove(1)}
        type="button"
        className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md transition-colors hover:bg-black/[0.035] dark:hover:bg-white/[0.05]"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

export function WorkspaceLearningCard({
  reviewChatId,
  onOpen,
  actions,
  index,
  onMove,
}: {
  reviewChatId?: string;
  onOpen: () => void;
  actions: OverviewAction[];
  index: number;
  onMove: (direction: number) => void;
}) {
  return (
    <article className="relative flex min-h-0 flex-1 flex-col items-start justify-center p-7">
      <MatrixLoader
        ariaLabel="Chief is learning"
        className="text-muted-foreground mb-6"
        fps={6}
        size={15}
      />
      <Shimmer
        as="h2"
        className="text-[clamp(24px,3vw,34px)] leading-tight font-normal tracking-[-0.03em]"
        duration={2.8}
        spread={1.25}
      >
        Finish setting up with Chief.
      </Shimmer>
      <p className="text-muted-foreground mt-3 mb-6 max-w-[520px] text-[13px] leading-6">
        Open mission control to follow connections, initial research, and
        recurring work with Chief and Setup.
      </p>
      <button
        className={cn(overviewButton, "bg-foreground text-background")}
        type="button"
        disabled={!reviewChatId}
        onClick={onOpen}
      >
        {reviewChatId ? "Open mission control" : "Preparing channel"}{" "}
        <ArrowRight size={13} />
      </button>
      <OverviewActionPagination
        actions={actions}
        className="absolute right-6 bottom-6"
        index={index}
        onMove={onMove}
      />
    </article>
  );
}
