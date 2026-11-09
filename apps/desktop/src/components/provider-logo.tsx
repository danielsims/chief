import { useState } from "react";

import { cn } from "@chief/ui/lib/utils";

import { integrationLogoUrl } from "../lib/integrations";
import { GoogleLogo } from "./google-logo";

interface Backing {
  /** How far to enlarge a round or framed logo so it fills its tile. */
  scale: number;
  light: boolean;
}

const backingCache = new Map<string, Backing>();

/**
 * Some logos are a disc or a framed square inside a transparent canvas, such
 * as a coloured circle or a tile with its own thin outline. Measured from the
 * pixels alone, this is how much to enlarge one so its shape covers the
 * rounded tile and any outline falls outside it. Bare marks stay at 1.
 */
function coverScale(image: HTMLImageElement) {
  const size = 64;
  const middle = size / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return 1;
  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const at = (x: number, y: number) => {
    const index = (y * size + x) * 4;
    return [0, 1, 2, 3].map((offset) => pixels[index + offset] ?? 0);
  };
  const alpha = (x: number, y: number) => at(x, y)[3] ?? 0;
  const last = size - 1;
  if (
    [alpha(0, 0), alpha(last, 0), alpha(0, last), alpha(last, last)].some(
      (value) => value >= 32,
    )
  )
    return 1;
  const inset = (x: number, y: number, stepX: number, stepY: number) => {
    let step = 0;
    while (step < middle && alpha(x + stepX * step, y + stepY * step) < 128)
      step += 1;
    return step;
  };
  const sides: [number, number, number, number][] = [
    [middle, 0, 0, 1],
    [middle, last, 0, -1],
    [0, middle, 1, 0],
    [last, middle, -1, 0],
  ];
  const edges = sides.map(([x, y, stepX, stepY]) => inset(x, y, stepX, stepY));
  // A bare mark doesn't reach the edges, so it isn't a shape to fill.
  if (Math.max(...edges) > 3) return 1;
  const frames = sides.map(([x, y, stepX, stepY], side) => {
    const start = edges[side] ?? 0;
    const rim = at(x + stepX * start, y + stepY * start);
    let width = 0;
    while (
      width < 8 &&
      at(x + stepX * (start + width), y + stepY * (start + width))
        .slice(0, 3)
        .every((value, channel) => Math.abs(value - (rim[channel] ?? 0)) <= 48)
    )
      width += 1;
    return width <= 5 ? width : 0;
  });
  const corners = [
    inset(0, 0, 1, 1),
    inset(last, 0, -1, 1),
    inset(0, last, 1, -1),
    inset(last, last, -1, -1),
  ];
  const edge = Math.max(...edges);
  let scale = Math.max(
    // The tile's own rounding hides a little of each corner.
    (middle - 0.05 * size) / (middle - Math.max(...corners)),
    middle / (middle - edge),
  );
  if (Math.min(...frames) > 0)
    scale = Math.max(scale, middle / (middle - edge - Math.max(...frames) - 1));
  return Math.min(scale, 1.5);
}

function needsLightBacking(image: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return true;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let visible = 0;
  let luminance = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] ?? 0;
    if (alpha < 32) continue;
    visible += 1;
    luminance +=
      0.2126 * (pixels[index] ?? 0) +
      0.7152 * (pixels[index + 1] ?? 0) +
      0.0722 * (pixels[index + 2] ?? 0);
  }
  if (visible === 0) return false;
  const coverage = visible / (canvas.width * canvas.height);
  return coverage < 0.62 && luminance / visible < 150;
}

export function ProviderLogo({
  domain,
  label,
  className,
}: {
  domain: string;
  label: string;
  className?: string;
}) {
  return (
    <ProviderLogoImage
      key={domain}
      domain={domain}
      label={label}
      className={className}
    />
  );
}

function ProviderLogoImage({
  domain,
  label,
  className,
}: {
  domain: string;
  label: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [backing, setBacking] = useState<Backing>(
    () => backingCache.get(domain) ?? { scale: 1, light: false },
  );
  const isGoogle =
    domain === "google.com" ||
    domain === "workspace.google.com" ||
    domain === "analytics.googleapis.com" ||
    domain === "googleads.googleapis.com" ||
    domain.endsWith(".googleapis.com");

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white",
        !isGoogle && !backing.light && "bg-transparent",
        failed && "bg-muted",
        className,
      )}
    >
      {isGoogle ? (
        <GoogleLogo className="h-full w-full" />
      ) : failed ? (
        <span className="text-xs font-normal">{label.charAt(0)}</span>
      ) : (
        <img
          src={integrationLogoUrl(domain)}
          alt=""
          crossOrigin="anonymous"
          className="h-full w-full object-contain"
          style={
            backing.scale > 1
              ? { transform: `scale(${backing.scale})` }
              : undefined
          }
          onLoad={(event) => {
            let next: Backing;
            try {
              const scale = coverScale(event.currentTarget);
              next = {
                scale,
                light: scale === 1 && needsLightBacking(event.currentTarget),
              };
            } catch {
              next = { scale: 1, light: true };
            }
            backingCache.set(domain, next);
            setBacking(next);
          }}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
