import { useEffect, useState } from "react";

import { MatrixLoader } from "@chief/ui/components/matrix-loader";

import { useAgentLook } from "./agent-avatar";

/** Provider brand colours, for agents drawn with their provider's logo. */
export const providerBrandColors: Partial<Record<string, string>> = {
  claude: "#D97757",
};

const storageKey = (url: string) => `chief:avatar-color:${url}`;
const sampled = new Map<string, string | null>();

function storedColor(url: string): string | null | undefined {
  if (sampled.has(url)) return sampled.get(url);
  try {
    const stored = localStorage.getItem(storageKey(url));
    if (stored === null) return undefined;
    const color = stored || null;
    sampled.set(url, color);
    return color;
  } catch {
    return undefined;
  }
}

function rememberColor(url: string, color: string | null) {
  sampled.set(url, color);
  try {
    localStorage.setItem(storageKey(url), color ?? "");
  } catch {
    // The colour is resampled next time.
  }
}

const hex = (value: number) => Math.round(value).toString(16).padStart(2, "0");

/** The image's most vivid colour, ignoring near-white, near-black and
 * transparent pixels, so a logo's brand colour wins over its background. */
function vividColor(image: HTMLImageElement) {
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, size, size);
  const { data } = context.getImageData(0, 0, size, size);
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index] ?? 0;
    const g = data[index + 1] ?? 0;
    const b = data[index + 2] ?? 0;
    const a = (data[index + 3] ?? 0) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    if (a < 0.5 || max < 40 || (min > 225 && saturation < 0.1)) continue;
    const w = a * saturation * saturation;
    red += r * w;
    green += g * w;
    blue += b * w;
    weight += w;
  }
  if (weight < 1) return null;
  return `#${hex(red / weight)}${hex(green / weight)}${hex(blue / weight)}`;
}

/** Samples an avatar image's colour once and remembers it by URL. */
function useSampledColor(url: string | undefined) {
  const [, setVersion] = useState(0);
  const known = url ? storedColor(url) : null;
  useEffect(() => {
    if (!url || known !== undefined) return;
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      let color: string | null = null;
      try {
        color = vividColor(image);
      } catch {
        // A cross-origin image cannot be read; keep the default colour.
      }
      rememberColor(url, color);
      if (!cancelled) setVersion((version) => version + 1);
    };
    image.onerror = () => rememberColor(url, null);
    image.src = url;
    return () => {
      cancelled = true;
    };
  }, [known, url]);
  return known ?? undefined;
}

/**
 * The colour an agent's working indicator uses: its chosen colour, its
 * provider's brand colour, or the colour of its avatar image. White follows
 * the text colour so it stays visible in light mode.
 */
export function useAgentLoaderColor(agentId: string) {
  const look = useAgentLook(agentId, "");
  const explicit =
    look.kind === "style" || look.kind === "mark" || look.kind === "provider"
      ? look.color
      : undefined;
  const fromImage = useSampledColor(
    look.kind === "image" || look.kind === "sprite" ? look.url : undefined,
  );
  const color = explicit ?? fromImage;
  return color?.toLowerCase() === "#ffffff" ? undefined : color;
}

/** The matrix working indicator, in the agent's own colour. */
export function AgentMatrixLoader({
  agentId,
  ariaLabel,
  className,
  size,
}: {
  agentId: string;
  ariaLabel: string;
  className?: string;
  size: number;
}) {
  return (
    <MatrixLoader
      ariaLabel={ariaLabel}
      className={className}
      color={useAgentLoaderColor(agentId)}
      size={size}
    />
  );
}
