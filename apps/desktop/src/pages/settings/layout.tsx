import { NavLink, Outlet } from "react-router";
import { cn } from "@marketer/ui/lib/utils";

const sections = [
  { to: "/settings/profile", label: "Profile" },
  { to: "/settings/workspace", label: "Workspace" },
  { to: "/settings/integrations", label: "Integrations" },
  { to: "/settings/deployment", label: "Deployment" },
  // Agent configuration lives on the Agents page.
  // Billing is intentionally absent until billing exists.
];

export function SettingsLayout() {
  return (
    <div className="mx-auto max-w-5xl pt-10">
      <div>
        <h1 className="font-serif text-3xl">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage your account and workspace.
        </p>
      </div>
      <div className="mt-8 flex gap-10">
        <nav className="w-40 shrink-0 space-y-0.5">
          {sections.map((section) => (
            <NavLink
              key={section.to}
              to={section.to}
              className={({ isActive }) =>
                cn(
                  "block border border-transparent px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                  isActive && "border-border bg-accent text-foreground",
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
