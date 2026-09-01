import { ExternalAgentChannelService } from "./external-agent-channel";
import { firstRow } from "./workspace-channel-store";

export function drainExternalAgentOutbox(
  storage: DurableObjectStorage,
  env: Env,
) {
  const workspace = firstRow<
    { workspace_id: string } & Record<string, SqlStorageValue>
  >(storage.sql.exec("SELECT workspace_id FROM workspace WHERE singleton = 1"));
  if (!workspace) return Promise.resolve();
  return new ExternalAgentChannelService(storage, env).drain(
    workspace.workspace_id,
  );
}
