import { integrationLogoUrl } from "../../lib/integrations";
import type { IntegrationDependency } from "../../lib/playbooks";

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
          className="relative flex size-5 items-center justify-center overflow-hidden rounded-full border border-border bg-card text-[8px] font-medium text-muted-foreground"
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
          className="relative flex size-5 items-center justify-center rounded-full border border-border bg-card text-[8px] font-medium text-muted-foreground"
        >
          +{remaining}
        </span>
      ) : null}
    </span>
  );
}
