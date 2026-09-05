import { useState } from "react";
import { Check, FolderGit2 } from "lucide-react";

import type { GenerativeProjectRecommendationData } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";

import { AddProjectDialog } from "../projects/add-project-dialog";
import { useProjects } from "../../lib/runtime-projects";

function repositoryHost(url: string | undefined) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return null;
  }
}

export function ProjectConnectCard({
  recommendation,
}: {
  recommendation: GenerativeProjectRecommendationData;
}) {
  const projects = useProjects();
  const [open, setOpen] = useState(false);
  const remoteUrl = recommendation.remoteUrl;
  const alreadyConnected = projects.projects.some(
    (item) =>
      Boolean(remoteUrl) &&
      (item.project.canonicalRemoteUrl === remoteUrl ||
        item.project.repositoryWebUrl === remoteUrl),
  );
  const host = repositoryHost(remoteUrl);

  return (
    <>
      <div className="bg-card/60 flex min-w-0 items-center gap-3 rounded-2xl border px-3 py-2.5 shadow-sm">
        <span className="bg-muted flex size-10 items-center justify-center overflow-hidden rounded-xl">
          <FolderGit2 size={18} strokeWidth={1.7} />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-sm font-medium">
            {recommendation.title}
          </strong>
          <span className="text-muted-foreground block truncate text-xs">
            {host ?? recommendation.description}
          </span>
        </span>
        {alreadyConnected ? (
          <span className="flex items-center gap-1 text-xs text-emerald-500">
            <Check size={13} /> Connected
          </span>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Connect
          </Button>
        )}
      </div>
      <AddProjectDialog
        open={open}
        onOpenChange={setOpen}
        initialRemoteUrl={remoteUrl}
      />
    </>
  );
}
