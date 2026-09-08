import { ExternalAgentChannelService } from "./external-agent-channel";
import { workspaceFindDrainExternalAgentOutbox } from "./queries/workspace/find-drain-external-agent-outbox";
import { firstRow } from "./workspace-channel-store";

export function drainExternalAgentOutbox(
  storage: DurableObjectStorage,
  env: Env,
) {
  const workspace = firstRow<
    { workspace_id: string } & Record<string, SqlStorageValue>
  >(workspaceFindDrainExternalAgentOutbox(storage));
  if (!workspace) return Promise.resolve();
  return new ExternalAgentChannelService(storage, env).drain(
    workspace.workspace_id,
  );
}
