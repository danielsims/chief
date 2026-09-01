import { useEffect, useMemo, useState } from "react";
import { Check, Plus, RefreshCw, X } from "lucide-react";
import { useNavigate, useParams } from "react-router";

import { Button } from "@chief/ui/components/button";

import { PageTitle } from "../components/page-title";
import { AddProjectDialog } from "../components/projects/add-project-dialog";
import { ProjectCard } from "../components/projects/project-card";
import { ProjectDetail } from "../components/projects/project-detail";
import { useProjectAccessRequests } from "../lib/runtime-project-actions";
import { useProjects } from "../lib/runtime-projects";
import {
  isWorkspaceAgentId,
  WORKSPACE_AGENT_IDENTITIES,
} from "../lib/workspace-channels";

function projectAgentName(agentId: string) {
  return isWorkspaceAgentId(agentId)
    ? WORKSPACE_AGENT_IDENTITIES[agentId].name
    : agentId.replace(/^./u, (first) => first.toLocaleUpperCase());
}

function projectCapabilityName(capability: string) {
  return capability.replace(/^./u, (first) => first.toLocaleUpperCase());
}

const projectCapabilityOrder = [
  "view",
  "checkout",
  "commit",
  "publish",
  "review",
  "administer",
] as const;

function projectRequestCapabilities(request: {
  capabilities?: readonly string[];
  capability?: string;
}) {
  if (request.capabilities?.length) return request.capabilities;
  const level = request.capability
    ? projectCapabilityOrder.findIndex(
        (capability) => capability === request.capability,
      )
    : -1;
  return level >= 0 ? projectCapabilityOrder.slice(0, level + 1) : [];
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const projects = useProjects();
  const access = useProjectAccessRequests();
  const [adding, setAdding] = useState(false);
  const selected = useMemo(
    () => projects.projects.find((item) => item.project.id === projectId),
    [projectId, projects.projects],
  );
  const projectName = useMemo(() => {
    const names = new Map(
      projects.projects.map((item) => [item.project.id, item.project.name]),
    );
    return (id: string) => names.get(id) ?? id;
  }, [projects.projects]);

  const { refresh: refreshAccessRequests } = access;
  useEffect(() => refreshAccessRequests(), [refreshAccessRequests]);

  return (
    <section className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
      {selected ? null : (
        <header className="shrink-0 border-b border-black/[0.055] px-6 pt-5 pb-4 dark:border-white/[0.055]">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <PageTitle>Projects</PageTitle>
              <p className="text-muted-foreground mt-1 max-w-2xl text-[13px] leading-5">
                Git repositories shared across your workspace.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={projects.refresh}>
              <RefreshCw size={13} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus size={14} />
              Add project
            </Button>
          </div>
        </header>
      )}

      <div
        className={
          selected
            ? "min-h-0 flex-1"
            : "min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto px-6 py-6"
        }
      >
        {selected ? (
          <ProjectDetail
            key={selected.project.id}
            snapshot={selected}
            onBack={() => void navigate("/projects")}
            onRefresh={projects.refresh}
          />
        ) : access.requests?.length ? (
          <>
            <div className="border-border/70 mx-auto mb-4 max-w-6xl rounded-2xl border">
              <div className="border-border/70 flex min-h-10 items-center justify-between gap-4 border-b px-4 py-2 text-[13px] font-medium">
                <span>Agent access requests</span>
                {access.error ? (
                  <span className="text-destructive text-right text-[12px] font-normal">
                    {access.error}
                  </span>
                ) : null}
              </div>
              {access.requests.map((request) => (
                <div
                  key={request.id}
                  className="border-border/70 flex min-h-12 items-center gap-3 border-b px-4 text-[13px] last:border-b-0"
                >
                  <div className="min-w-0 flex-1 py-2">
                    <p>
                      <span className="font-medium">
                        {projectAgentName(request.agentId)}
                      </span>{" "}
                      requested access to{" "}
                      <span className="font-medium">
                        {projectName(request.projectId)}
                      </span>
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-muted-foreground text-[12px]">
                        Scopes
                      </span>
                      {projectRequestCapabilities(request).map((capability) => (
                        <span
                          key={capability}
                          className="border-border/70 bg-muted/40 rounded-md border px-1.5 py-0.5 text-[12px] leading-4"
                        >
                          {projectCapabilityName(capability)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    loading={access.busyId === request.id}
                    disabled={access.busyId !== null}
                    onClick={() => access.approve(request.id)}
                  >
                    <Check size={13} />
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={access.busyId !== null}
                    onClick={() => access.deny(request.id)}
                  >
                    <X size={13} />
                    Deny
                  </Button>
                </div>
              ))}
            </div>
            <div className="mx-auto grid w-full max-w-6xl gap-2 md:grid-cols-2 xl:grid-cols-3">
              {projects.projects.map((snapshot) => (
                <ProjectCard
                  key={snapshot.project.id}
                  snapshot={snapshot}
                  onClick={() =>
                    void navigate(
                      `/projects/${encodeURIComponent(snapshot.project.id)}`,
                    )
                  }
                />
              ))}
            </div>
          </>
        ) : projects.loading ? (
          <div className="mx-auto grid w-full max-w-6xl gap-2 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="bg-muted h-[116px] animate-pulse rounded-2xl"
              />
            ))}
          </div>
        ) : projects.projects.length === 0 ? (
          <div className="bg-sidebar mx-auto flex min-h-64 w-full max-w-6xl flex-col items-center justify-center rounded-2xl border border-black/[0.055] px-8 py-14 text-center dark:border-white/[0.055]">
            <p className="text-[18px] leading-tight font-medium tracking-[-0.025em]">
              No projects yet
            </p>
            <p className="text-muted-foreground mt-1.5 text-[12px] leading-5">
              Add a repository from this Mac or a Git URL.
            </p>
            <Button className="mt-4" onClick={() => setAdding(true)}>
              <Plus size={14} />
              Add project
            </Button>
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-6xl gap-2 md:grid-cols-2 xl:grid-cols-3">
            {projects.projects.map((snapshot) => (
              <ProjectCard
                key={snapshot.project.id}
                snapshot={snapshot}
                onClick={() =>
                  void navigate(
                    `/projects/${encodeURIComponent(snapshot.project.id)}`,
                  )
                }
              />
            ))}
          </div>
        )}
      </div>

      <AddProjectDialog open={adding} onOpenChange={setAdding} />
    </section>
  );
}
