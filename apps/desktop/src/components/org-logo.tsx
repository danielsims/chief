import { useEffect, useMemo, useRef, useState } from "react";
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
  const candidates = useMemo(() => {
    const siteCandidates = faviconCandidates(website ?? "");
    return Array.from(
      new Map(
        [
          logo ? { src: logo, minimumWidth: minimumFaviconWidth(logo) } : null,
          ...siteCandidates.map((src) => ({
            src,
            minimumWidth: minimumFaviconWidth(src),
          })),
        ]
          .filter(
            (candidate): candidate is { src: string; minimumWidth: number } =>
              Boolean(candidate),
          )
          .map((candidate) => [candidate.src, candidate]),
      ).values(),
    );
  }, [logo, website]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const candidate = candidates[candidateIndex];
  useEffect(() => {
    setCandidateIndex(0);
    setLoaded(false);
  }, [logo, website]);

  useEffect(() => {
    const image = imageRef.current;
    if (!image || !candidate) return;
    const frame = requestAnimationFrame(() => {
      if (!image.complete) return;
      if (image.naturalWidth >= candidate.minimumWidth) {
        setLoaded(true);
      } else if (image.naturalWidth > 0) {
        setLoaded(false);
        setCandidateIndex((index) =>
          index === candidateIndex ? index + 1 : index,
        );
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [candidate, candidateIndex]);

  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <span
      className={cn(
        "relative flex items-center justify-center overflow-hidden border",
        loaded ? "bg-transparent" : "bg-accent",
        className,
      )}
    >
      <span className="translate-y-[0.055em] font-serif leading-none select-none">
        {initial}
      </span>
      {candidate ? (
        <img
          ref={imageRef}
          src={candidate.src}
          alt=""
          draggable={false}
          className={cn(
            "absolute inset-0 h-full w-full object-cover",
            loaded ? "opacity-100" : "opacity-0",
            // imgClassName exists to inset small site favicons; an uploaded
            // workspace logo always covers its tile edge to edge.
            candidate.src === logo ? undefined : imgClassName,
          )}
          onError={() => {
            setLoaded(false);
            setCandidateIndex((index) => index + 1);
          }}
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth < candidate.minimumWidth) {
              setLoaded(false);
              setCandidateIndex((index) => index + 1);
              return;
            }
            setLoaded(true);
          }}
        />
      ) : null}
    </span>
  );
}

function websiteOrigin(website: string): URL | null {
  const trimmed = website.trim();
  if (!trimmed) return null;
  try {
    return new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
  } catch {
    return null;
  }
}

function faviconCandidates(website: string): string[] {
  const url = websiteOrigin(website);
  if (!url) return [];
  return [
    `${url.origin}/favicon.ico`,
    `${url.origin}/favicon.svg`,
    `${url.origin}/apple-touch-icon.png`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=64`,
  ];
}

function minimumFaviconWidth(url: string) {
  return url.includes("google.com/s2/favicons") ? 32 : 16;
}

/** Google's favicon endpoint, used consistently anywhere a workspace appears. */
export function faviconUrl(website: string): string | null {
  const url = websiteOrigin(website);
  return url
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=64`
    : null;
}

/**
 * Preflight a favicon URL in the browser. Resolves true only when the image
 * loads and is at least 32px wide, filtering out the s2 generic-globe stub.
 * Used before persisting a favicon URL as a workspace logo.
 */
export function faviconLoads(
  url: string,
  minimumWidth = minimumFaviconWidth(url),
): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth >= minimumWidth);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/** Resolve the site's own icon first, using Google only as a final fallback. */
export async function resolveFaviconUrl(
  website: string,
): Promise<string | null> {
  for (const candidate of faviconCandidates(website)) {
    if (await faviconLoads(candidate)) return candidate;
  }
  return null;
}
