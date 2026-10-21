import { useMemo, useState } from "react";
import { ListFilter, Plus, RefreshCw } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { z } from "zod";

import { Button } from "@chief/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";

import { listColumnClass } from "../components/list-row";
import { PageHeader } from "../components/page-header";
import { AddProjectDialog } from "../components/projects/add-project-dialog";
import { ProjectDetail } from "../components/projects/project-detail";
import { ProjectRow } from "../components/projects/project-row";
import { useRelaySession } from "../lib/relay-session-context";
import { useProjects } from "../lib/runtime-projects";

const projectFilterSchema = z.enum(["all", "repositories", "agents"]);

export function ProjectsPage() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const projects = useProjects();
  const relay = useRelaySession();
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
  return (
    <section className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
      {selected ? null : (
        <PageHeader
          title="Repositories"
          description="Git repositories your team and agents work in."
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
                      ? "Agents' repositories"
                      : projectFilter === "repositories"
                        ? "Repositories"
                        : "All repositories"}
                  </span>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="all">All repositories</SelectItem>
                  <SelectItem value="repositories">Repositories</SelectItem>
                  <SelectItem value="agents">Agents' repositories</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={projects.refresh}>
                <RefreshCw size={13} />
                Refresh
              </Button>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus size={14} />
                Add repository
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
            onBack={() => void navigate("/repositories")}
            onRefresh={projects.refresh}
            onDelete={async () => {
              if (!relay.client) throw new Error("Chief isn't connected yet.");
              await relay.client.deleteProject(selected.project.id);
              projects.refresh();
              void navigate("/repositories");
            }}
          />
        ) : projects.loading ? (
          <div className={listColumnClass}>
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="bg-muted/60 my-1 h-12 animate-pulse rounded-lg"
              />
            ))}
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="flex min-h-full w-full flex-col items-center justify-center px-8 py-10 text-center">
            <p className="text-[18px] leading-tight font-medium tracking-[-0.025em]">
              {projects.projects.length === 0
                ? "No repositories yet"
                : "No matching repositories"}
            </p>
            <p className="text-muted-foreground mt-1.5 text-[12px] leading-5">
              {projects.projects.length === 0
                ? "Add a repository from this Mac or a Git URL."
                : "Choose another filter."}
            </p>
            {projects.projects.length === 0 ? (
              <Button className="mt-4" onClick={() => setAdding(true)}>
                <Plus size={14} />
                Add repository
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className={listColumnClass}>
            {visibleProjects.map((snapshot) => (
              <ProjectRow
                key={snapshot.project.id}
                snapshot={snapshot}
                onClick={() =>
                  void navigate(
                    `/repositories/${encodeURIComponent(snapshot.project.id)}`,
                  )
                }
              />
            ))}
          </ul>
        )}
      </div>

      <AddProjectDialog open={adding} onOpenChange={setAdding} />
    </section>
  );
}
