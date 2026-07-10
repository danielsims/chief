import { useState } from "react";
import { Link } from "react-router";
import type { ProspectRecord } from "@marketer/agent-runtime/types";
import { cn } from "@marketer/ui/lib/utils";
import { ExternalLink } from "lucide-react";

import { useAuth } from "../lib/auth/auth-context";
import { useWorkspaceData } from "../lib/runtime";

const filters = ["all", "new", "researching", "contacted"] as const;

function relevanceClass(relevance: ProspectRecord["relevance"]) {
  if (relevance === "high") return "bg-emerald-500";
  if (relevance === "medium") return "bg-amber-400";
  return "bg-muted-foreground";
}

export function ProspectsPage() {
  const { cloudOrganizationId } = useAuth();
  const { prospects, loading } = useWorkspaceData(cloudOrganizationId);
  const [filter, setFilter] = useState<(typeof filters)[number]>("all");
  const visible = prospects.filter(
    (prospect) => filter === "all" || prospect.status === filter,
  );

  return (
    <div className="-mx-8 -mb-8 min-h-[calc(100vh-48px)]">
      <header className="flex items-end justify-between gap-6 border-b px-8 pb-5 pt-4">
        <div>
          <h1 className="font-serif text-3xl">Prospects</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            People and conversations worth a considered response.
          </p>
        </div>
        <div className="flex border p-0.5">
          {filters.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={cn(
                "px-3 py-1.5 text-xs capitalize text-muted-foreground transition-colors hover:text-foreground",
                filter === item && "bg-accent text-foreground",
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </header>

      {loading && prospects.length === 0 ? (
        // Pending is not empty: hold a quiet frame instead of flashing the
        // empty state's serif heading before rows arrive.
        <div aria-busy="true" className="min-h-[calc(100vh-170px)]" />
      ) : visible.length > 0 ? (
        <div className="px-8 py-6">
          <div className="border">
            <div className="grid grid-cols-[minmax(180px,1.1fr)_120px_100px_minmax(260px,2fr)_110px] border-b bg-card px-4 py-2.5 text-[11px] text-muted-foreground">
              <span>Prospect</span>
              <span>Source</span>
              <span>Relevance</span>
              <span>Why it matters</span>
              <span>Found</span>
            </div>
            {visible.map((prospect) => (
              <div
                key={prospect.id}
                className="grid grid-cols-[minmax(180px,1.1fr)_120px_100px_minmax(260px,2fr)_110px] items-start border-b px-4 py-4 text-sm last:border-b-0"
              >
                <div className="min-w-0 pr-5">
                  <p className="truncate font-medium">{prospect.name}</p>
                  {prospect.company ? (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {prospect.company}
                    </p>
                  ) : null}
                </div>
                <div>
                  {prospect.sourceUrl ? (
                    <a
                      href={prospect.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {prospect.source}
                      <ExternalLink size={11} />
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {prospect.source}
                    </span>
                  )}
                </div>
                <span className="inline-flex items-center gap-2 text-xs capitalize text-muted-foreground">
                  <span
                    className={cn(
                      "size-1.5",
                      relevanceClass(prospect.relevance),
                    )}
                  />
                  {prospect.relevance}
                </span>
                <p className="pr-6 text-xs leading-5 text-muted-foreground">
                  {prospect.summary}
                </p>
                <div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(prospect.foundAt).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <p className="mt-1 text-[10px] capitalize text-muted-foreground/70">
                    {prospect.status}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-[calc(100vh-170px)] items-center justify-center px-8 text-center">
          <div className="max-w-sm">
            <p className="font-serif text-2xl">No prospects yet</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The Prospector saves relevant people and public conversations here
              as it finds them.
            </p>
            <Link
              to="/conversations?agent=prospector"
              className="mt-5 inline-block border px-3 py-2 text-xs transition-colors hover:bg-accent"
            >
              Open Prospector
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
