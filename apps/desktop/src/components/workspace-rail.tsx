import { useEffect, useState } from "react";
import { Home } from "lucide-react";
import { useLocation, useNavigate } from "react-router";

import { cn } from "@chief/ui/lib/utils";

import { useAuth } from "../lib/auth/auth-context";
import { listAuthOrganizations } from "../lib/auth/better-auth-client";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function WorkspaceRail({
  onVisibilityChange,
}: {
  onVisibilityChange?: (visible: boolean) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const [workspaceCount, setWorkspaceCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      onVisibilityChange?.(false);
      return;
    }
    let cancelled = false;
    void listAuthOrganizations().then((organizations) => {
      if (!cancelled) {
        setWorkspaceCount(organizations.length);
        onVisibilityChange?.(organizations.length > 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, onVisibilityChange]);

  if (!isAuthenticated || workspaceCount === null || workspaceCount < 2) {
    return null;
  }

  return (
    <nav
      aria-label="Workspaces"
      className="bg-sidebar relative z-50 flex w-12 shrink-0 flex-col items-center pb-3"
    >
      <div className="h-10 shrink-0" data-tauri-drag-region />
      <WorkspaceSwitcher variant="rail" />
      <div className="bg-sidebar-border my-3 h-px w-5" />
      <button
        type="button"
        aria-label="Overview"
        onClick={() => navigate("/")}
        className={cn(
          "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex size-9 items-center justify-center rounded-2xl transition-all hover:rounded-xl",
          location.pathname === "/" &&
            "bg-sidebar-accent text-sidebar-foreground rounded-xl",
        )}
      >
        <Home size={15} />
      </button>
    </nav>
  );
}
