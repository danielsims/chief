import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router";

import type { TrendRecord } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import { useAuth } from "../lib/auth/auth-context";
import { useWorkspaceData } from "../lib/runtime";

const filters = ["all", "new", "watching", "acted"] as const;

function signalClass(signal: TrendRecord["signal"]) {
  if (signal === "high") return "bg-emerald-500";
  if (signal === "medium") return "bg-amber-400";
  return "bg-muted-foreground";
}

export function TrendingPage() {
  const { cloudOrganizationId } = useAuth();
  const { trends, loading } = useWorkspaceData(cloudOrganizationId);
  const [filter, setFilter] = useState<(typeof filters)[number]>("all");
  const visible = trends.filter(
    (trend) => filter === "all" || trend.status === filter,
  );

  return (
    <div className="-mx-8 -mb-8 min-h-[calc(100vh-48px)]">
      <header className="flex items-end justify-between gap-6 border-b px-8 pt-4 pb-5">
        <div>
          <h1 className="font-serif text-3xl">Trending</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Signals worth watching across your market and channels.
          </p>
        </div>
        <div className="flex border p-0.5">
          {filters.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={cn(
                "text-muted-foreground hover:text-foreground px-3 py-1.5 text-xs capitalize transition-colors",
                filter === item && "bg-accent text-foreground",
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </header>

      {loading && trends.length === 0 ? (
        // Pending is not empty: hold a quiet frame instead of flashing the
        // empty state's serif heading before rows arrive.
        <div aria-busy="true" className="min-h-[calc(100vh-170px)]" />
      ) : visible.length > 0 ? (
        <div className="px-8 py-6">
          <div className="border">
            <div className="bg-card text-muted-foreground grid grid-cols-[minmax(220px,1.2fr)_120px_100px_minmax(280px,2fr)_110px] border-b px-4 py-2.5 text-[11px]">
              <span>Trend</span>
              <span>Source</span>
              <span>Signal</span>
              <span>Why it matters</span>
              <span>Found</span>
            </div>
            {visible.map((trend) => (
              <div
                key={trend.id}
                className="grid grid-cols-[minmax(220px,1.2fr)_120px_100px_minmax(280px,2fr)_110px] items-start border-b px-4 py-4 text-sm last:border-b-0"
              >
                <p className="min-w-0 truncate pr-5 font-medium">
                  {trend.title}
                </p>
                <div>
                  {trend.sourceUrl ? (
                    <a
                      href={trend.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
                    >
                      {trend.source}
                      <ExternalLink size={11} />
                    </a>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      {trend.source}
                    </span>
                  )}
                </div>
                <span className="text-muted-foreground inline-flex items-center gap-2 text-xs capitalize">
                  <span className={cn("size-1.5", signalClass(trend.signal))} />
                  {trend.signal}
                </span>
                <p className="text-muted-foreground pr-6 text-xs leading-5">
                  {trend.summary}
                </p>
                <div>
                  <p className="text-muted-foreground text-xs">
                    {new Date(trend.foundAt).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <p className="text-muted-foreground/70 mt-1 text-[10px] capitalize">
                    {trend.status}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-[calc(100vh-170px)] items-center justify-center px-8 text-center">
          <div className="max-w-sm">
            <p className="font-serif text-2xl">No trends yet</p>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              The Prospector saves supported market signals here, with the
              source and why each one matters.
            </p>
            <Link
              to="/conversations?agent=prospector"
              className="hover:bg-accent mt-5 inline-block border px-3 py-2 text-xs transition-colors"
            >
              Open Prospector
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
