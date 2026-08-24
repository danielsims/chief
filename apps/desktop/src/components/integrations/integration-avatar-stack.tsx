import type { IntegrationDependency } from "../../lib/playbook-types";
import { integrationLogoUrl } from "../../lib/integrations";

export function IntegrationAvatarStack({
  integrations,
  max = 4,
}: {
  integrations?: IntegrationDependency[];
  max?: number;
}) {
  if (!integrations?.length) return null;
  const names = integrations.map((integration) => integration.label).join(", ");
  const visible = integrations.slice(0, max);
  const remaining = integrations.length - visible.length;

  return (
    <span
      role="img"
      aria-label={`Uses ${names}`}
      className="flex shrink-0 -space-x-1"
    >
      {visible.map((integration) => (
        <span
          key={integration.domain}
          title={integration.label}
          aria-hidden="true"
          className="border-border bg-card text-muted-foreground relative flex size-5 items-center justify-center overflow-hidden rounded-full border text-[8px] font-medium"
        >
          {integration.label.slice(0, 1).toUpperCase()}
          <img
            src={integrationLogoUrl(integration.domain)}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
            onError={(event) => event.currentTarget.remove()}
          />
        </span>
      ))}
      {remaining > 0 ? (
        <span
          aria-hidden="true"
          className="border-border bg-card text-muted-foreground relative flex size-5 items-center justify-center rounded-full border text-[8px] font-medium"
        >
          +{remaining}
        </span>
      ) : null}
    </span>
  );
}
