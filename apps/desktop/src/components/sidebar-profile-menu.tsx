import { useState } from "react";
import { Building2, ChevronUp, Palette, Settings } from "lucide-react";
import { useNavigate } from "react-router";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@chief/ui/components/popover";

import { useAuth } from "../lib/auth/auth-context";

const ITEMS = [
  { label: "Settings", to: "/settings/profile", icon: Settings },
  { label: "Workspace", to: "/settings/workspace", icon: Building2 },
  { label: "Appearance", to: "/settings/appearance", icon: Palette },
] as const;

export function SidebarProfileMenu() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="group/profile hover:bg-sidebar-accent/70 data-[state=open]:bg-sidebar-accent/70 flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors">
        <span className="bg-sidebar-accent flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-xl text-xs font-semibold">
          {user?.image ? (
            <img src={user.image} alt="" className="size-full object-cover" />
          ) : (
            (user?.name.trim().charAt(0) ?? "C").toLocaleUpperCase()
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-4 font-semibold">
            {user?.name ?? "Chief workspace"}
          </span>
          <span className="text-sidebar-muted block truncate text-[10px]">
            {user?.email ?? "Account and preferences"}
          </span>
        </span>
        <ChevronUp
          size={13}
          className="text-sidebar-muted shrink-0 opacity-70 transition-transform group-data-[state=open]/profile:rotate-180"
        />
      </PopoverTrigger>
      <PopoverContent side="right" align="end" sideOffset={10} className="w-56">
        <div className="px-2 py-1.5">
          <p className="truncate text-xs font-medium">
            {user?.name ?? "Chief workspace"}
          </p>
          <p className="text-muted-foreground mt-0.5 truncate text-[11px]">
            {user?.email}
          </p>
        </div>
        <div className="bg-border/70 my-1 h-px" />
        {ITEMS.map(({ label, to, icon: Icon }) => (
          <button
            key={to}
            type="button"
            onClick={() => {
              setOpen(false);
              void navigate(to);
            }}
            className="hover:bg-accent focus:bg-accent flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors outline-none"
          >
            <Icon size={14} className="text-muted-foreground" />
            {label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
