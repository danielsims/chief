import { useEffect, useState } from "react";

import { cn } from "@chief/ui/lib/utils";

import { integrationLogoUrl } from "../lib/integrations";
import { GoogleLogo } from "./google-logo";

const lightBackingCache = new Map<string, boolean>();

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
  const [failed, setFailed] = useState(false);
  const [lightBacking, setLightBacking] = useState(
    () => lightBackingCache.get(domain) ?? false,
  );
  useEffect(() => {
    setFailed(false);
    setLightBacking(lightBackingCache.get(domain) ?? false);
  }, [domain]);
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
        !isGoogle && !lightBacking && "bg-transparent",
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
          onLoad={(event) => {
            try {
              const next = needsLightBacking(event.currentTarget);
              lightBackingCache.set(domain, next);
              setLightBacking(next);
            } catch {
              lightBackingCache.set(domain, true);
              setLightBacking(true);
            }
          }}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
