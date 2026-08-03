import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  MessagesSquare,
} from "lucide-react";
import {
  Line,
  LineChart,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";

import type { ActionItem } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import type { AuthOrganization } from "../lib/auth/better-auth-client";
import { parseOrganizationMetadata } from "../lib/auth/better-auth-client";
import { OrgLogo } from "./org-logo";

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

function chartPointLabel(value: string) {
  const compactDate = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  const dashedDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const match = compactDate ?? dashedDate;
  if (!match) return value;
  const [, year, month, day] = match;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(new Date(Number(year), Number(month) - 1, Number(day)));
}

export function AnalyticsChart({
  label,
  points,
  reduceMotion,
}: {
  label: string;
  points: { x: string; value: number }[];
  reduceMotion: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className="text-foreground/65 absolute right-[18px] bottom-[42px] left-[18px] h-[58px]"
    >
      <ResponsiveContainer height="100%" width="100%">
        <LineChart
          data={points}
          margin={{ bottom: 2, left: 2, right: 2, top: 2 }}
        >
          <RechartsTooltip
            allowEscapeViewBox={{ x: true, y: true }}
            content={({ active, payload }) => {
              const point = payload[0]?.payload as
                { x?: string; value?: number } | undefined;
              if (!active || point?.value === undefined) return null;
              return (
                <div className="border-border bg-popover text-popover-foreground min-w-28 border px-2.5 py-2 shadow-lg">
                  {point.x ? (
                    <p className="text-muted-foreground text-[10px]">
                      {chartPointLabel(point.x)}
                    </p>
                  ) : null}
                  <p className="mt-0.5 flex items-baseline justify-between gap-4 text-xs">
                    <span>{label}</span>
                    <strong className="font-medium">
                      {formatNumber(point.value)}
                    </strong>
                  </p>
                </div>
              );
            }}
            cursor={false}
            isAnimationActive={false}
            wrapperStyle={{ pointerEvents: "none", zIndex: 5 }}
          />
          <Line
            activeDot={{ fill: "var(--foreground)", r: 3, strokeWidth: 0 }}
            animationDuration={420}
            dataKey="value"
            dot={false}
            isAnimationActive={!reduceMotion}
            stroke="var(--foreground)"
            strokeOpacity={0.68}
            strokeWidth={1.25}
            type="linear"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Trend({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-[9px] text-emerald-500">New</span>;
  }
  const positive = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[9px]",
        positive ? "text-emerald-500" : "text-red-500",
      )}
    >
      {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
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
        website={
          typeof metadata.websiteUrl === "string" ? metadata.websiteUrl : ""
        }
        className="size-6 shrink-0 text-xs"
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
      <MessagesSquare className="text-muted-foreground mb-6" size={18} />
      <h2 className="text-[clamp(24px,3vw,34px)] leading-tight font-normal tracking-[-0.03em]">
        Finish setting up with Chief.
      </h2>
      <p className="text-muted-foreground mt-3 mb-6 max-w-[520px] text-[13px] leading-6">
        Open the private getting-started channel to work through connections,
        initial research, and recurring work with Chief and Setup.
      </p>
      <button
        className={cn(overviewButton, "bg-foreground text-background")}
        type="button"
        disabled={!reviewChatId}
        onClick={onOpen}
      >
        {reviewChatId ? "Open getting started" : "Preparing channel"}{" "}
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
