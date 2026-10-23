/**
 * A soft band holding a white card, as automation steps are drawn. Used for
 * steps on the canvas and for runs in a conversation, so the two look alike.
 */
export const insetBandClass =
  "rounded-[16px] bg-[color-mix(in_srgb,var(--foreground)_4%,var(--background))] p-1 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_7%,transparent)]";

export const insetCardClass =
  "bg-background rounded-[12px] px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.05),inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)]";
