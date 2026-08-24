import { useMemo, useState } from "react";
import { GitBranch, GitCompareArrows, Send, Trash2 } from "lucide-react";

import type {
  ProjectCommitSummary,
  ProjectRepositoryBrowserSnapshot,
  ProjectRepositorySnapshot,
} from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";

import type { ProjectCurrentUser } from "./project-user-avatar";
import { useProjectCheckoutActions } from "../../lib/runtime-project-actions";
import { ProjectCommitList } from "./project-commit-list";
import { ProjectUserAvatar } from "./project-user-avatar";

export function ProjectRepositorySidebar({
  snapshot,
  browser,
  currentUser,
  onSelectCommit,
  onReviewCheckout,
}: {
  snapshot: ProjectRepositorySnapshot;
  browser: ProjectRepositoryBrowserSnapshot | undefined;
  currentUser: ProjectCurrentUser | null;
  onSelectCommit: (commit: ProjectCommitSummary) => void;
  onReviewCheckout: (branch: string) => void;
}) {
  const { busy, error, publish, discard } = useProjectCheckoutActions();
  const [discarding, setDiscarding] = useState<string | null>(null);
  const busyCheckout = useMemo(() => {
    return discarding ?? null;
  }, [discarding]);

  const handleDiscard = async (checkoutId: string, branch: string) => {
    if (
      !window.confirm(
        `Discard all uncommitted changes on ${branch}? This cannot be undone.`,
      )
    ) {
      return;
    }
    setDiscarding(checkoutId);
    try {
      await discard(checkoutId);
    } finally {
      setDiscarding(null);
    }
  };

  return (
    <aside className="space-y-7">
      <section>
        <h3 className="text-[14px] font-medium">Contributors</h3>
        <div className="mt-3 space-y-2.5">
          {browser?.contributors.length ? (
            browser.contributors.map((contributor) => {
              return (
                <div
                  key={contributor.email}
                  className="flex items-center gap-2.5"
                >
                  <ProjectUserAvatar
                    name={contributor.name}
                    email={contributor.email}
                    currentUser={currentUser}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {contributor.name}
                    </span>
                    <span className="text-muted-foreground block text-[12px]">
                      {contributor.commits} commits
                    </span>
                  </span>
                </div>
              );
            })
          ) : (
            <p className="text-muted-foreground text-[13px]">
              Contributor history will appear here.
            </p>
          )}
        </div>
      </section>

      <section>
        <h3 className="text-[14px] font-medium">Recent commits</h3>
        <ProjectCommitList
          commits={browser?.commits ?? snapshot.commits}
          currentUser={currentUser}
          onSelect={onSelectCommit}
        />
      </section>

      <section>
        <h3 className="text-[14px] font-medium">Agent branches</h3>
        <div className="mt-3 space-y-2">
          {snapshot.checkouts.length ? (
            snapshot.checkouts.map((checkout) => (
              <div
                key={checkout.id}
                className="border-border/70 flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-2 text-[13px]"
              >
                <GitBranch
                  size={14}
                  className="text-muted-foreground shrink-0"
                />
                <span
                  className="min-w-0 flex-1 truncate"
                  title={checkout.branch}
                >
                  {checkout.branch}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Review ${checkout.branch}`}
                  title="Review branch"
                  onClick={() => onReviewCheckout(checkout.branch)}
                >
                  <GitCompareArrows size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Publish ${checkout.branch}`}
                  title="Publish branch"
                  loading={busy}
                  onClick={() => void publish(checkout.id)}
                >
                  <Send size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Discard ${checkout.branch}`}
                  title="Discard changes"
                  loading={busyCheckout === checkout.id}
                  disabled={
                    busyCheckout !== null && busyCheckout !== checkout.id
                  }
                  onClick={() =>
                    void handleDiscard(checkout.id, checkout.branch)
                  }
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground text-[13px]">
              No agent branches yet.
            </p>
          )}
          {error ? (
            <p className="border-destructive/20 bg-destructive/[0.05] text-destructive rounded-lg border px-3 py-2 text-[12px]">
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </aside>
  );
}
