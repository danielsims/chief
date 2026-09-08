import {
  Activity,
  ArrowLeft,
  Bell,
  Bot,
  Building2,
  KeyRound,
  MonitorCog,
  MonitorUp,
  Radio,
  Target,
  UserRound,
  Webhook,
} from "lucide-react";
import { NavLink } from "react-router";

import { cn } from "@chief/ui/lib/utils";

const groups = [
  {
    label: "Personal",
    items: [
      { to: "/settings/profile", label: "Profile", icon: UserRound },
      { to: "/settings/appearance", label: "Appearance", icon: MonitorCog },
      { to: "/settings/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Workspace",
    items: [
      { to: "/settings/workspace", label: "Workspace", icon: Building2 },
      { to: "/settings/connection", label: "Connection", icon: Radio },
      { to: "/settings/missions", label: "Missions", icon: Target },
      { to: "/settings/webhooks", label: "Webhooks", icon: Webhook },
      { to: "/settings/environment", label: "Environment", icon: KeyRound },
      { to: "/settings/machines", label: "Machines", icon: MonitorUp },
    ],
  },
  {
    label: "App",
    items: [
      { to: "/settings/agents", label: "Agents", icon: Bot },
      { to: "/settings/diagnostics", label: "Diagnostics", icon: Activity },
    ],
  },
] as const;

export function SettingsSidebar({ width }: { width: number }) {
  return (
    <aside
      style={{ width }}
      className="bg-sidebar text-sidebar-foreground flex h-full shrink-0 flex-col"
    >
      <div className="px-3 pt-3 pb-2">
        <NavLink
          to="/"
          className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] transition-colors"
        >
          <ArrowLeft size={15} />
          Back to app
        </NavLink>
      </div>
      <nav
        aria-label="Settings"
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
      >
        {groups.map((group) => (
          <section key={group.label} className="mb-6 last:mb-0">
            <p className="text-sidebar-muted/70 mb-1.5 px-2 text-[11px] font-medium">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors",
                      isActive &&
                        "bg-sidebar-accent text-sidebar-foreground font-medium",
                    )
                  }
                >
                  <Icon size={15} strokeWidth={1.8} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          </section>
        ))}
      </nav>
    </aside>
  );
}
