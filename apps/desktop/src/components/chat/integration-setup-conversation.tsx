import { integrationSetupTask } from "../../lib/integration-setup";
import { IntegrationSetupPanel } from "./integration-setup-panel";

export function IntegrationSetupConversation({
  chatId,
  domain,
  actionId,
}: {
  chatId: string;
  domain: string;
  actionId?: string;
}) {
  const name =
    domain === "analytics.googleapis.com" ? "Google Analytics" : domain;
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
          sessionKey={domain}
          prompt={integrationSetupTask({ domain, name })}
          standalone
        />
      </div>
    </div>
  );
}
