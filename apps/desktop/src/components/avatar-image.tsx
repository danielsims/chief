import type { ReactNode } from "react";
import { useState } from "react";

/**
 * A person's picture that shows `fallback` (usually their initial) when there
 * is no image or it fails to load. Provider avatars such as Google's reject
 * requests that carry a referrer, so none is sent.
 */
export function AvatarImage({
  className,
  fallback,
  src,
}: {
  className?: string;
  fallback: ReactNode;
  src: string | null | undefined;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <>{fallback}</>;
  return (
    <img
      alt=""
      className={className}
      onError={() => setFailedSrc(src)}
      referrerPolicy="no-referrer"
      src={src}
    />
  );
}
