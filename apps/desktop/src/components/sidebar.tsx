import { NavLink, useLocation } from "react-router";
import {
  LayoutGrid,
  ChartLine,
  CalendarClock,
  Users,
  Flame,
  Network,
  Settings,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@marketer/ui/components/tooltip";
import { cn } from "@marketer/ui/lib/utils";

const items = [
  { to: "/", label: "Overview", icon: LayoutGrid },
  { to: "/analytics", label: "Analytics", icon: ChartLine },
  { to: "/schedule", label: "Schedule", icon: CalendarClock },
  { to: "/prospects", label: "Prospects", icon: Users },
  { to: "/trending", label: "Trending", icon: Flame },
  { to: "/agents", label: "Agents", icon: Network },
];

function RailItem({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: typeof LayoutGrid;
}) {
  const { pathname } = useLocation();
  const isActive = to === "/" ? pathname === "/" : pathname.startsWith(to);
  // NavLink's function-style className can't be used here: TooltipTrigger's
  // Slot merges className as a string and would stringify the function into
  // the DOM. Compute active state ourselves and pass a plain string.
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <NavLink
          to={to}
          className={cn(
            "flex h-10 w-10 items-center justify-center border border-transparent text-muted-foreground transition-colors hover:text-foreground",
            isActive && "border-border bg-accent text-foreground",
          )}
        >
          <Icon size={18} strokeWidth={1.75} />
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-[70px] flex-col items-center border-r bg-background">
      {/* Taller drag region with the wordmark pushed below the macOS
          window controls so the logo isn't crowding the traffic lights. */}
      <div
        data-tauri-drag-region
        className="titlebar-drag flex h-[92px] w-full flex-col items-center justify-end border-b pb-[24px]"
      >
        <span
          data-tauri-drag-region
          className="font-serif text-xl italic leading-none select-none"
        >
          m.
        </span>
      </div>
      <nav className="flex flex-1 flex-col items-center gap-2 pt-4">
        {items.map((item) => (
          <RailItem key={item.to} {...item} />
        ))}
      </nav>
      <div className="flex flex-col items-center gap-2 pb-4">
        <RailItem to="/settings" label="Settings" icon={Settings} />
      </div>
    </aside>
  );
}
