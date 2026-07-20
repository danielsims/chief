import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router";

import type { ProspectRecord } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

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
      <header className="flex items-end justify-between gap-6 border-b px-8 pt-4 pb-5">
        <div>
          <h1 className="font-serif text-3xl">Prospects</h1>
          <p className="text-muted-foreground mt-2 text-sm">
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
                "text-muted-foreground hover:text-foreground px-3 py-1.5 text-xs capitalize transition-colors",
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
            <div className="bg-card text-muted-foreground grid grid-cols-[minmax(180px,1.1fr)_120px_100px_minmax(260px,2fr)_110px] border-b px-4 py-2.5 text-[11px]">
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
                    <p className="text-muted-foreground mt-1 truncate text-xs">
                      {prospect.company}
                    </p>
                  ) : null}
                </div>
                <div>
                  {prospect.sourceUrl ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (prospect.sourceUrl) {
                          void openUrl(prospect.sourceUrl);
                        }
                      }}
                      className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-left text-xs underline-offset-2 hover:underline"
                    >
                      {prospect.source}
                      <ExternalLink size={11} />
                    </button>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      {prospect.source}
                    </span>
                  )}
                </div>
                <span className="text-muted-foreground inline-flex items-center gap-2 text-xs capitalize">
                  <span
                    className={cn(
                      "size-1.5",
                      relevanceClass(prospect.relevance),
                    )}
                  />
                  {prospect.relevance}
                </span>
                <p className="text-muted-foreground pr-6 text-xs leading-5">
                  {prospect.summary}
                </p>
                <div>
                  <p className="text-muted-foreground text-xs">
                    {new Date(prospect.foundAt).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <p className="text-muted-foreground/70 mt-1 text-[10px] capitalize">
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
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              Chief saves relevant people and public conversations here after
              consulting the Prospector.
            </p>
            <Link
              to="/conversations"
              className="hover:bg-accent mt-5 inline-block border px-3 py-2 text-xs transition-colors"
            >
              Ask Chief about prospects
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
