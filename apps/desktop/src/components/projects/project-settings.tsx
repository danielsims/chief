import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Link } from "react-router";

import type { ProjectRepositorySnapshot } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@chief/ui/components/dialog";
import { Input } from "@chief/ui/components/input";

import { useRuntime } from "../../lib/runtime";
import { workspaceAgentIdentity } from "../../lib/workspace-channels";

export function ProjectSettings({
  snapshot,
  onDelete,
}: {
  snapshot: ProjectRepositorySnapshot;
  onDelete: () => Promise<void>;
}) {
  const { project } = snapshot;
  const { agents } = useRuntime();
  return (
    <div className="max-w-2xl space-y-10">
      {project.agentId ? (
        <section>
          <h3 className="text-sm font-medium">Agent</h3>
          <div className="border-border/70 mt-3 flex items-center justify-between gap-6 rounded-2xl border px-4 py-4">
            <p className="text-[13px] font-medium">
              {workspaceAgentIdentity(project.agentId, agents).name}
            </p>
            <Button
              variant="outline"
              size="sm"
              render={
                <Link
                  to={`/agents?agent=${encodeURIComponent(project.agentId)}`}
                />
              }
            >
              Open agent
            </Button>
          </div>
        </section>
      ) : null}
      <ProjectDangerZone name={project.name} onDelete={onDelete} />
    </div>
  );
}

function ProjectDangerZone({
  name,
  onDelete,
}: {
  name: string;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Chief couldn't delete this project.",
      );
      setDeleting(false);
    }
  };

  return (
    <section>
      <h3 className="text-destructive text-sm font-medium">Delete project</h3>
      <div className="border-destructive/30 mt-3 flex items-center justify-between gap-6 rounded-2xl border px-4 py-4">
        <div>
          <p className="text-[13px] font-medium">Delete {name}</p>
          <p className="text-muted-foreground mt-1 text-[13px] leading-5 font-normal">
            Removes it from this workspace. The repository itself isn't changed.
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            setConfirmation("");
            setError(null);
            setOpen(true);
          }}
        >
          <Trash2 size={13} />
          Delete project
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {name}</DialogTitle>
            <DialogDescription>
              Type the project name to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={name}
          />
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={confirmation !== name || deleting}
              onClick={() => void remove()}
            >
              {deleting ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
