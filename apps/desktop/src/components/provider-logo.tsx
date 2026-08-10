import { useEffect, useState } from "react";

import { cn } from "@chief/ui/lib/utils";

import { integrationLogoUrl } from "../lib/integrations";
import { GoogleLogo } from "./google-logo";

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
  useEffect(() => setFailed(false), [domain]);
  const isGoogle =
    domain === "google.com" ||
    domain === "analytics.googleapis.com" ||
    domain === "googleads.googleapis.com";

  return (
    <span
      className={cn("flex shrink-0 items-center justify-center", className)}
    >
      {isGoogle ? (
        <GoogleLogo className="h-full w-full" />
      ) : failed ? (
        <span className="text-xs font-normal">{label.charAt(0)}</span>
      ) : (
        <img
          src={integrationLogoUrl(domain)}
          alt=""
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
