import { useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { useNavigate, useParams } from "react-router";

import { Button } from "@chief/ui/components/button";

import { PageTitle } from "../components/page-title";
import { AddProjectDialog } from "../components/projects/add-project-dialog";
import { ProjectCard } from "../components/projects/project-card";
import { ProjectDetail } from "../components/projects/project-detail";
import { useProjects } from "../lib/runtime-projects";

export function ProjectsPage() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const projects = useProjects();
  const [adding, setAdding] = useState(false);
  const selected = useMemo(
    () => projects.projects.find((item) => item.project.id === projectId),
    [projectId, projects.projects],
  );

  return (
    <section className="-mx-8 -mb-8 flex h-[calc(100vh-48px)] min-w-0 flex-col overflow-hidden">
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

      <div className="min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto px-6 py-6">
        {selected ? (
          <ProjectDetail
            key={selected.project.id}
            snapshot={selected}
            onBack={() => void navigate("/projects")}
            onRefresh={projects.refresh}
          />
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
