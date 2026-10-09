import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  FolderGit2,
  FolderOpen,
  KeyRound,
  LayoutGrid,
  MonitorCog,
  Network,
  Plug,
  Radio,
  Target,
  UserRound,
  Webhook,
} from "lucide-react";

export const DESTINATIONS = [
  { label: "Overview", hint: "Workspace home", to: "/", icon: LayoutGrid },
  {
    label: "Schedule",
    hint: "Recurring work",
    to: "/schedule",
    icon: CalendarClock,
  },
  {
    label: "Projects",
    hint: "Git repositories",
    to: "/projects",
    icon: FolderGit2,
  },
  { label: "Agents", hint: "Your team", to: "/agents", icon: Network },
  { label: "Plugins", hint: "Connected tools", to: "/plugins", icon: Plug },
  {
    label: "Analytics",
    hint: "Measurement and reporting",
    to: "/analytics",
    icon: BarChart3,
  },
  { label: "Files", hint: "Workspace context", to: "/files", icon: FolderOpen },
] as const;

export const SETTINGS = [
  {
    to: "/settings/profile",
    label: "Profile",
    keywords: "name avatar photo account email",
    icon: UserRound,
  },
  {
    to: "/settings/appearance",
    label: "Appearance",
    keywords: "theme dark light mode",
    icon: MonitorCog,
  },
  {
    to: "/settings/notifications",
    label: "Notifications",
    keywords: "alerts sounds",
    icon: Bell,
  },
  {
    to: "/settings/workspace",
    label: "Workspace",
    keywords: "members people invitations invite links logo website delete",
    icon: Building2,
  },
  {
    to: "/settings/connection",
    label: "Connection",
    keywords: "relay server network",
    icon: Radio,
  },
  {
    to: "/settings/missions",
    label: "Missions",
    keywords: "goals objectives",
    icon: Target,
  },
  {
    to: "/settings/webhooks",
    label: "Webhooks",
    keywords: "integrations events",
    icon: Webhook,
  },
  {
    to: "/settings/environment",
    label: "Environment",
    keywords: "secrets keys variables api",
    icon: KeyRound,
  },
  {
    to: "/settings/diagnostics",
    label: "Diagnostics",
    keywords: "debug logs experimental",
    icon: Activity,
  },
] as const;

/** The part of a message around the first match, on one line. */
export function snippet(body: string, needle: string): string {
  const text = body.replace(/\s+/g, " ").trim();
  const at = text.toLocaleLowerCase().indexOf(needle);
  if (at < 0) return text.slice(0, 120);
  const start = Math.max(0, at - 40);
  return `${start > 0 ? "…" : ""}${text.slice(start, at + needle.length + 80)}`;
}
