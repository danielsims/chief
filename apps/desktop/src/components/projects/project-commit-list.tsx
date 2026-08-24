import type { ProjectCommitSummary } from "@chief/agent-runtime/types";

import type { ProjectCurrentUser } from "./project-user-avatar";
import { formatProjectTime } from "./project-format";
import { ProjectUserAvatar } from "./project-user-avatar";

interface CommitGroup {
  key: string;
  label: string;
  commits: ProjectCommitSummary[];
}

function startOfDay(value: number) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dayLabel(value: number) {
  const today = startOfDay(Date.now());
  const day = startOfDay(value);
  if (day === today) return "Today";
  if (day === today - 86_400_000) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value);
}

function groupCommits(commits: ProjectCommitSummary[]) {
  const groups: CommitGroup[] = [];
  for (const commit of commits) {
    const key = String(startOfDay(commit.authoredAt));
    const existing = groups.at(-1);
    if (existing?.key === key) {
      existing.commits.push(commit);
    } else {
      groups.push({
        key,
        label: dayLabel(commit.authoredAt),
        commits: [commit],
      });
    }
  }
  return groups;
}

export function ProjectCommitList({
  commits,
  currentUser,
  onSelect,
  detailed = false,
  limit = 7,
}: {
  commits: ProjectCommitSummary[];
  currentUser: ProjectCurrentUser | null;
  onSelect: (commit: ProjectCommitSummary) => void;
  detailed?: boolean;
  limit?: number;
}) {
  const groups = groupCommits(commits.slice(0, limit));

  return (
    <div className={detailed ? "space-y-6" : "mt-3 space-y-5"}>
      {groups.map((group) => (
        <section key={group.key}>
          <h4 className="text-muted-foreground mb-2 text-[13px]">
            {group.label}
          </h4>
          <div className="border-border/70 overflow-hidden rounded-xl border">
            {group.commits.map((commit) => (
              <button
                type="button"
                key={commit.hash}
                onClick={() => onSelect(commit)}
                className="border-border/70 hover:bg-muted/30 focus-visible:bg-muted/30 flex w-full min-w-0 items-center gap-3 border-b px-3 py-3 text-left transition-colors outline-none last:border-b-0"
              >
                <ProjectUserAvatar
                  name={commit.authorName}
                  email={commit.authorEmail}
                  currentUser={currentUser}
                  className={detailed ? "size-8" : "size-7"}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={
                      detailed
                        ? "block truncate text-[14px] font-medium"
                        : "block truncate text-[13px]"
                    }
                    title={commit.subject}
                  >
                    {commit.subject}
                  </span>
                  <span className="text-muted-foreground mt-1 flex min-w-0 items-center gap-1.5 text-[12px]">
                    <span className="truncate">{commit.authorName}</span>
                    <span className="shrink-0">
                      committed {formatProjectTime(commit.authoredAt)}
                    </span>
                    {detailed ? (
                      <span className="ml-auto shrink-0 font-mono">
                        {commit.shortHash}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
