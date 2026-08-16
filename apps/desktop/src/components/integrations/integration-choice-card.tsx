import { cn } from "@chief/ui/lib/utils";

import type { IntegrationSearchResult } from "../../lib/integrations";
import { ProviderLogo } from "../provider-logo";

export function IntegrationChoiceCard({
  integration,
  selected,
  onClick,
  compact = false,
}: {
  integration: IntegrationSearchResult;
  selected: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "bg-background hover:border-foreground flex items-start gap-3 overflow-hidden rounded-xl border text-left transition-colors",
        compact ? "h-16 items-center px-3 py-2" : "h-[100px] p-4",
        selected && "border-foreground bg-muted",
      )}
    >
      <ProviderLogo
        domain={integration.domain}
        label={integration.name}
        className="size-8 overflow-hidden rounded-lg"
      />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {integration.name}
        </span>
        {!compact ? (
          <span className="text-muted-foreground mt-1 line-clamp-2 block text-xs leading-5">
            {integration.description || integration.domain}
          </span>
        ) : null}
      </span>
    </button>
  );
}
