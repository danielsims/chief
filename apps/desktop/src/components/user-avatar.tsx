import { cn } from "@chief/ui/lib/utils";

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
        "bg-muted inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold",
        className,
      )}
    >
      {image ? (
        <img src={image} alt="" className="size-full object-cover" />
      ) : (
        name.trim().charAt(0).toLocaleUpperCase() || "?"
      )}
    </span>
  );
}
