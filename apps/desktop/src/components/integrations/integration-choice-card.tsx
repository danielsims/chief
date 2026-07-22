import { useState } from "react";

import { cn } from "@chief/ui/lib/utils";

import type { IntegrationSearchResult } from "../../lib/integrations";
import { integrationLogoUrl } from "../../lib/integrations";
import { GoogleLogo } from "../google-logo";

function IntegrationLogo({
  integration,
}: {
  integration: IntegrationSearchResult;
}) {
  const [failed, setFailed] = useState(false);
  if (integration.domain.endsWith(".googleapis.com")) {
    return (
      <span className="bg-background flex h-7 w-7 shrink-0 items-center justify-center border">
        <GoogleLogo className="h-4 w-4" />
      </span>
    );
  }

  if (integration.domain === "none" || failed) {
    return (
      <span className="bg-background text-muted-foreground flex h-7 w-7 shrink-0 items-center justify-center border text-[10px]">
        {integration.name.slice(0, 1)}
      </span>
    );
  }

  return (
    <span className="bg-background flex h-7 w-7 shrink-0 items-center justify-center border">
      <img
        src={integrationLogoUrl(integration.domain)}
        alt=""
        className="h-4 w-4"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

export function IntegrationChoiceCard({
  integration,
  selected,
  onClick,
}: {
  integration: IntegrationSearchResult;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "bg-background hover:border-foreground flex h-[100px] items-start gap-3 overflow-hidden border p-4 text-left transition-colors",
        selected && "border-foreground bg-muted",
      )}
    >
      <IntegrationLogo integration={integration} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {integration.name}
        </span>
        <span className="text-muted-foreground mt-1 line-clamp-2 block text-xs leading-5">
          {integration.description || integration.domain}
        </span>
        {integration.kinds.length ? (
          <span className="mt-2 flex flex-wrap gap-1">
            {integration.kinds.slice(0, 3).map((kind) => (
              <span
                key={kind}
                className="text-muted-foreground border px-1.5 py-0.5 text-[10px] uppercase"
              >
                {kind}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </button>
  );
}
