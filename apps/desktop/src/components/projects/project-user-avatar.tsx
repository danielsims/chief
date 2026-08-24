import { UserRound } from "lucide-react";

import { cn } from "@chief/ui/lib/utils";

export interface ProjectCurrentUser {
  name: string;
  email: string;
  image?: string;
}

function matchesCurrentUser(
  name: string,
  email: string | undefined,
  currentUser: ProjectCurrentUser | null,
) {
  if (!currentUser) return false;
  const normalizedName = name.trim().toLowerCase();
  const normalizedEmail = email?.trim().toLowerCase();
  return (
    normalizedName === currentUser.name.trim().toLowerCase() ||
    (normalizedEmail &&
      normalizedEmail === currentUser.email.trim().toLowerCase())
  );
}

export function ProjectUserAvatar({
  name,
  email,
  currentUser,
  className,
}: {
  name: string;
  email?: string;
  currentUser: ProjectCurrentUser | null;
  className?: string;
}) {
  const image = matchesCurrentUser(name, email, currentUser)
    ? currentUser?.image
    : undefined;
  if (image) {
    return (
      <img
        src={image}
        alt=""
        className={cn("size-8 shrink-0 rounded-full object-cover", className)}
        referrerPolicy="no-referrer"
      />
    );
  }
  const value = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span
      className={cn(
        "bg-muted flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-medium",
        className,
      )}
    >
      {value || <UserRound size={13} />}
    </span>
  );
}
