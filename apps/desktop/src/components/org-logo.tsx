import { useEffect, useState } from "react";
import { cn } from "@marketer/ui/lib/utils";

/**
 * Square workspace logo-or-initial tile, shared by the workspace switcher,
 * the dashboard workspace indicator and the settings preview.
 *
 * Falls back to the workspace's first initial (serif, matching the wordmark)
 * when there is no logo, the image fails to load, or the image is a stub.
 * Google's s2 favicon service never 404s: when a site has no real favicon it
 * returns a 16x16 generic globe even at sz=64, so anything under 32px wide is
 * treated as "no logo".
 */
export function OrgLogo({
  name,
  logo,
  website,
  className,
  imgClassName,
}: {
  name: string;
  logo?: string | null;
  website?: string | null;
  className?: string;
  imgClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const src = logo || faviconUrl(website ?? "");
  useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);

  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const showImage = Boolean(src) && !failed;

  return (
    <span
      className={cn(
        "relative flex items-center justify-center overflow-hidden border bg-accent",
        className,
      )}
    >
      {!loaded ? (
        <span className="translate-y-[0.055em] font-serif leading-none select-none">
          {initial}
        </span>
      ) : null}
      {showImage ? (
        <img
          src={src ?? undefined}
          alt=""
          draggable={false}
          className={cn(
            "absolute inset-0 h-full w-full object-cover",
            loaded ? "opacity-100" : "opacity-0",
            imgClassName,
          )}
          onError={() => {
            setLoaded(false);
            setFailed(true);
          }}
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth < 32) {
              setFailed(true);
              return;
            }
            setLoaded(true);
          }}
        />
      ) : null}
    </span>
  );
}

/** Google's favicon endpoint, used consistently anywhere a workspace appears. */
export function faviconUrl(website: string): string | null {
  const trimmed = website.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=64`;
  } catch {
    return null;
  }
}

/**
 * Preflight a favicon URL in the browser. Resolves true only when the image
 * loads and is at least 32px wide, filtering out the s2 generic-globe stub.
 * Used before persisting a favicon URL as a workspace logo.
 */
export function faviconLoads(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth >= 32);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}
