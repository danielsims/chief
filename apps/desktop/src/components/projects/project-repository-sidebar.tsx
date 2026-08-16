import { GitBranch } from "lucide-react";

import type {
  ProjectCommitSummary,
  ProjectRepositoryBrowserSnapshot,
  ProjectRepositorySnapshot,
} from "@chief/agent-runtime/types";

import type { ProjectCurrentUser } from "./project-user-avatar";
import { ProjectCommitList } from "./project-commit-list";
import { ProjectUserAvatar } from "./project-user-avatar";

export function ProjectRepositorySidebar({
  snapshot,
  browser,
  currentUser,
  onSelectCommit,
}: {
  snapshot: ProjectRepositorySnapshot;
  browser: ProjectRepositoryBrowserSnapshot | undefined;
  currentUser: ProjectCurrentUser | null;
  onSelectCommit: (commit: ProjectCommitSummary) => void;
}) {
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
                className="border-border/70 flex min-h-11 items-center gap-2.5 rounded-xl border px-3 text-[13px]"
              >
                <GitBranch size={14} className="text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {checkout.branch}
                </span>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground text-[13px]">
              No agent branches yet.
            </p>
          )}
        </div>
      </section>
    </aside>
  );
}
