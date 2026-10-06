import { cn } from "@chief/ui/lib/utils";

import { AvatarImage } from "./avatar-image";

/** A human member avatar; agents use the separate AgentAvatar treatment. */
export function UserAvatar({
  className,
  image,
  name,
}: {
  className?: string;
  image?: string;
  name: string;
}) {
  return (
    <span
      className={cn(
        "bg-muted inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[28%] text-xs font-semibold",
        className,
      )}
    >
      <AvatarImage
        className="size-full object-cover"
        fallback={name.trim().charAt(0).toLocaleUpperCase() || "?"}
        src={image}
      />
    </span>
  );
}
