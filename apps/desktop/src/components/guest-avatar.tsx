import type { GuestAppearance } from "@chief/agent-runtime/types";
import { cn } from "@chief/ui/lib/utils";

import { guestProvider } from "../lib/guest-appearance";
import { AvatarImage } from "./avatar-image";
import { GrokMark } from "./grok-mark";
import { ProviderLogo } from "./provider-logo";

/** An outside agent's own picture, its drawn Grok Bot mark, its provider's
 * logo, or its initial, in that order. */
export function GuestAvatar({
  className,
  guest,
}: {
  className?: string;
  guest: Pick<GuestAppearance, "name" | "image" | "mark"> &
    Partial<Pick<GuestAppearance, "provider">>;
}) {
  const product = guestProvider(guest.provider);
  const mark = guest.mark ? (
    <GrokMark
      className="size-full"
      color={guest.mark.color}
      shape={guest.mark.shape}
    />
  ) : product ? (
    <ProviderLogo
      className="size-full"
      domain={product.domain}
      label={product.name}
    />
  ) : (
    guest.name.charAt(0).toLocaleUpperCase()
  );
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden",
        guest.mark && !guest.image
          ? "bg-transparent"
          : "bg-muted text-muted-foreground font-semibold",
        className,
      )}
    >
      <AvatarImage
        className="size-full object-cover"
        fallback={mark}
        src={guest.image}
      />
    </span>
  );
}
