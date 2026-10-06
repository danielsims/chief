import { cn } from "@chief/ui/lib/utils";

/**
 * A Grok Bot drawn from the `avatarShape` and `avatarColor` in its own
 * `profile.json`: a solid silhouette with two eyes. Drawn here rather than by
 * a third-party package; unknown values fall back to a grey blob.
 */

interface Silhouette {
  /** SVG path in a 40 × 40 box. */
  d: string;
  /** Vertical centre of the eyes. */
  eyes: number;
}

const silhouettes: Record<string, Silhouette> = {
  blob: {
    d: "M20 4.5c8.6 0 15.2 5.6 15.5 13.6.3 8.8-6.1 17.4-15.8 17.4C10.6 35.5 4.5 29.4 4.5 21 4.5 11.4 11 4.5 20 4.5Z",
    eyes: 19,
  },
  pebble: {
    d: "M5 22.5C5 14.4 11.6 8 20.6 8 29.4 8 35 13.6 35 21.2 35 29.6 28.4 34 20 34 11.2 34 5 29.8 5 22.5Z",
    eyes: 20,
  },
  bean: {
    d: "M11.5 7.5c5.2-2.9 8.4 1.7 12.6.6 4.6-1.2 11.1-1.3 11.4 7.6.4 10.4-6.2 19.8-16.1 19.8C9.8 35.5 4.5 29.6 4.5 21.4c0-6.4 2.6-11.2 7-13.9Z",
    eyes: 19,
  },
  egg: {
    d: "M20 4c7.4 0 13 10.6 13 19.2C33 30.4 27.2 36 20 36S7 30.4 7 23.2C7 14.6 12.6 4 20 4Z",
    eyes: 22,
  },
  squircle: {
    d: "M20 5c11.6 0 15 3.4 15 15s-3.4 15-15 15S5 31.6 5 20 8.4 5 20 5Z",
    eyes: 19,
  },
  tablet: {
    d: "M15 4h10c4.4 0 6 1.6 6 6v20c0 4.4-1.6 6-6 6H15c-4.4 0-6-1.6-6-6V10c0-4.4 1.6-6 6-6Z",
    eyes: 16,
  },
  capsule: {
    d: "M15 10.5h10a9.5 9.5 0 0 1 0 19H15a9.5 9.5 0 0 1 0-19Z",
    eyes: 20,
  },
  cylinder: {
    d: "M8 10c0-3.3 5.4-5.5 12-5.5S32 6.7 32 10v20c0 3.3-5.4 5.5-12 5.5S8 33.3 8 30V10Z",
    eyes: 18,
  },
  hex: {
    d: "M17.5 4.7a5 5 0 0 1 5 0l10 5.8a5 5 0 0 1 2.5 4.3v10.4a5 5 0 0 1-2.5 4.3l-10 5.8a5 5 0 0 1-5 0l-10-5.8A5 5 0 0 1 5 25.2V14.8a5 5 0 0 1 2.5-4.3l10-5.8Z",
    eyes: 19,
  },
  gem: {
    d: "M12.6 6h14.8a3 3 0 0 1 2.4 1.2l5 6.6a3 3 0 0 1-.1 3.7L22.3 33.6a3 3 0 0 1-4.6 0L5.3 17.5a3 3 0 0 1-.1-3.7l5-6.6A3 3 0 0 1 12.6 6Z",
    eyes: 15,
  },
  crystal: {
    d: "M18 4.2a3 3 0 0 1 4 0l8 8a3 3 0 0 1 .8 2.6l-3.4 18.6a3 3 0 0 1-3 2.6h-8.8a3 3 0 0 1-3-2.6L9.2 14.8a3 3 0 0 1 .8-2.6l8-8Z",
    eyes: 18,
  },
  wedge: {
    d: "M17.4 7.4a3 3 0 0 1 5.2 0l12.5 23.1a3 3 0 0 1-2.6 4.5H7.5a3 3 0 0 1-2.6-4.5L17.4 7.4Z",
    eyes: 25,
  },
  shield: {
    d: "M18.6 4.4a4 4 0 0 1 2.8 0l11 4A4 4 0 0 1 35 12.2V19c0 8.6-5.8 14.6-13.4 17a5 5 0 0 1-3.2 0C10.8 33.6 5 27.6 5 19v-6.8a4 4 0 0 1 2.6-3.8l11-4Z",
    eyes: 18,
  },
  dome: {
    d: "M20 9c8.3 0 15 6.7 15 15v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-6c0-8.3 6.7-15 15-15Z",
    eyes: 23,
  },
  arch: {
    d: "M20 4c7.2 0 13 5.8 13 13v15a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4V17C7 9.8 12.8 4 20 4Z",
    eyes: 17,
  },
  cloud: {
    d: "M11.5 32a7.5 7.5 0 0 1-1.3-14.9A10 10 0 0 1 29.4 14 7.5 7.5 0 0 1 29 32H11.5Z",
    eyes: 22,
  },
  teardrop: {
    d: "M20 4c5.4 7.6 13 13.8 13 21a13 13 0 0 1-26 0c0-7.2 7.6-13.4 13-21Z",
    eyes: 25,
  },
  leaf: {
    d: "M9 31C8 17 17 7 33 7c1 16-8 25-22 25a2 2 0 0 1-2-1Z",
    eyes: 22,
  },
};

const colors: Record<string, string> = {
  black: "#232326",
  brown: "#8b5e3c",
  red: "#e8483f",
  orange: "#f08a24",
  yellow: "#f0b429",
  green: "#34c27f",
  cyan: "#22b8c7",
  blue: "#3b82f6",
  violet: "#8b5cf6",
  magenta: "#d946c4",
  gray: "#9ca3af",
};

export function GrokMark({
  className,
  color,
  label,
  shape,
}: {
  className?: string;
  color: string;
  label?: string;
  shape: string;
}) {
  const silhouette = silhouettes[shape] ?? silhouettes.blob;
  const fill = colors[color] ?? colors.gray;
  if (!silhouette || !fill) return null;
  return (
    <svg
      viewBox="0 0 40 40"
      className={cn("size-8 shrink-0", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={silhouette.d} fill={fill} />
      <ellipse cx="15.5" cy={silhouette.eyes} rx="2.2" ry="2.8" fill="#fff" />
      <ellipse cx="24.5" cy={silhouette.eyes} rx="2.2" ry="2.8" fill="#fff" />
    </svg>
  );
}
