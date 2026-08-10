import { NavLink, Outlet } from "react-router";

import { cn } from "@chief/ui/lib/utils";

import { PageTitle } from "../../components/page-title";

const sections = [
  { to: "/settings/profile", label: "Profile" },
  { to: "/settings/workspace", label: "Workspace" },
  { to: "/settings/appearance", label: "Appearance" },
  { to: "/settings/notifications", label: "Notifications" },
  { to: "/settings/integrations", label: "Integrations" },
  { to: "/settings/environment", label: "Environment" },
  // Agent configuration lives on the Agents page.
  // Billing is intentionally absent until billing exists.
];

export function SettingsLayout() {
  return (
    <div className="mx-auto max-w-5xl pt-10">
      <div>
        <PageTitle>Settings</PageTitle>
        <p className="text-muted-foreground mt-2 text-sm">
          Manage your account and workspace.
        </p>
      </div>
      <div className="mt-8 flex flex-col gap-8 sm:flex-row sm:gap-10">
        <nav className="flex max-w-full shrink-0 gap-1 overflow-x-auto sm:w-40 sm:flex-col sm:gap-0 sm:space-y-0.5">
          {sections.map((section) => (
            <NavLink
              key={section.to}
              to={section.to}
              className={({ isActive }) =>
                cn(
                  "text-muted-foreground hover:bg-accent/60 hover:text-foreground block shrink-0 rounded-lg border border-transparent px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                  isActive && "border-border/70 bg-accent text-foreground",
                )
              }
            >
              {section.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1 space-y-8 pb-10">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
