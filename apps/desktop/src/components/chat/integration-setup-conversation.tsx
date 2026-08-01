import { INTEGRATION_CATALOG } from "../../lib/integration-catalog";
import { integrationSetupTask } from "../../lib/integration-setup";
import { IntegrationSetupPanel } from "./integration-setup-panel";

export function IntegrationSetupConversation({
  chatId,
  domain,
  actionId,
  channelId,
}: {
  chatId: string;
  domain: string;
  actionId?: string;
  channelId?: string;
}) {
  const name =
    INTEGRATION_CATALOG.flatMap((group) => group.integrations).find(
      (integration) => integration.domain === domain,
    )?.name ?? domain;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="text-muted-foreground flex h-11 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <span className="size-1.5 bg-blue-500" />
        <span>Setup</span>
        <span aria-hidden>/</span>
        <strong className="text-foreground font-medium">{name}</strong>
      </div>
      <div className="min-h-0 flex-1">
        <IntegrationSetupPanel
          chatId={chatId}
          actionId={actionId}
          channelId={channelId}
          sessionKey={domain}
          prompt={integrationSetupTask({ domain, name })}
          standalone
        />
      </div>
    </div>
  );
}
