import { useEffect, useMemo, useState } from "react";
import { Check, ListFilter, Plus, RefreshCw, X } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { z } from "zod";

import { Button } from "@chief/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";

import { PageHeader } from "../components/page-header";
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

const projectFilterSchema = z.enum(["all", "repositories", "agents"]);

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
  const [projectFilter, setProjectFilter] = useState<
    "all" | "repositories" | "agents"
  >("all");
  const visibleProjects = useMemo(
    () =>
      projects.projects.filter(({ project }) => {
        if (projectFilter === "agents") return Boolean(project.agentId);
        if (projectFilter === "repositories") return !project.agentId;
        return true;
      }),
    [projectFilter, projects.projects],
  );
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
        <PageHeader
          title="Projects"
          description="Git repositories shared across your workspace."
          actions={
            <>
              <Select
                value={projectFilter}
                onValueChange={(value) => {
                  const parsed = projectFilterSchema.safeParse(value);
                  if (parsed.success) setProjectFilter(parsed.data);
                }}
              >
                <SelectTrigger className="h-8 w-[152px] text-xs">
                  <ListFilter className="size-3.5" />
                  <span>
                    {projectFilter === "agents"
                      ? "Agent projects"
                      : projectFilter === "repositories"
                        ? "Repositories"
                        : "All projects"}
                  </span>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="all">All projects</SelectItem>
                  <SelectItem value="repositories">Repositories</SelectItem>
                  <SelectItem value="agents">Agent projects</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={projects.refresh}>
                <RefreshCw size={13} />
                Refresh
              </Button>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus size={14} />
                Add project
              </Button>
            </>
          }
        />
      )}

      <div
        className={
          selected
            ? "min-h-0 flex-1"
            : "min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto px-6 pb-6"
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
            <div className="border-border/70 mb-4 rounded-2xl border">
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
            <div className="grid w-full gap-2 md:grid-cols-2 xl:grid-cols-3">
              {visibleProjects.map((snapshot) => (
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
          <div className="grid w-full gap-2 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="bg-muted h-[116px] animate-pulse rounded-2xl"
              />
            ))}
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="flex min-h-full w-full flex-col items-center justify-center px-8 py-10 text-center">
            <p className="text-[18px] leading-tight font-medium tracking-[-0.025em]">
              {projects.projects.length === 0
                ? "No projects yet"
                : "No matching projects"}
            </p>
            <p className="text-muted-foreground mt-1.5 text-[12px] leading-5">
              {projects.projects.length === 0
                ? "Add a repository from this Mac or a Git URL."
                : "Choose another project filter."}
            </p>
            {projects.projects.length === 0 ? (
              <Button className="mt-4" onClick={() => setAdding(true)}>
                <Plus size={14} />
                Add project
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="grid w-full gap-2 md:grid-cols-2 xl:grid-cols-3">
            {visibleProjects.map((snapshot) => (
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
