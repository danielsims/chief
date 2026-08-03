import { Bot } from "lucide-react";

import { Button } from "@chief/ui/components/button";

import type { WorkspaceAgentId } from "../lib/workspace-channels";
import { WORKSPACE_AGENT_IDENTITIES } from "../lib/workspace-channels";
import { AgentAvatar } from "./agent-avatar";

interface ChannelDetailsUser {
  name: string;
  email: string;
  image?: string;
}

function getAgentIdentity(agentId: string) {
  if (Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, agentId)) {
    return WORKSPACE_AGENT_IDENTITIES[agentId as WorkspaceAgentId];
  }
  return { name: agentId, role: "Workspace agent" };
}

function MemberAvatar({ image, name }: { image?: string; name: string }) {
  return (
    <span className="bg-muted flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl text-xs font-semibold">
      {image ? (
        <img src={image} alt="" className="size-full object-cover" />
      ) : (
        name.charAt(0).toLocaleUpperCase()
      )}
    </span>
  );
}

export function ChannelMembersPanel({
  agentIds,
  user,
}: {
  agentIds: readonly string[];
  user: ChannelDetailsUser | null;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Channel members</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          People and agents participating in this channel.
        </p>
      </div>
      <div className="border-border/70 bg-muted/25 divide-y overflow-hidden rounded-2xl border">
        {user ? (
          <div className="flex items-center gap-3 px-4 py-3.5">
            <MemberAvatar image={user.image} name={user.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <p className="text-muted-foreground truncate text-xs">
                {user.email}
              </p>
            </div>
            <span className="bg-background/45 text-muted-foreground rounded-md px-2 py-1 text-[10px] font-semibold uppercase">
              You
            </span>
          </div>
        ) : null}
        {agentIds.map((agentId) => {
          const identity = getAgentIdentity(agentId);
          return (
            <div key={agentId} className="flex items-center gap-3 px-4 py-3.5">
              <AgentAvatar
                label={identity.name}
                className="size-9 rounded-xl"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {identity.name}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {identity.role}
                </p>
              </div>
              <span className="bg-background/45 text-muted-foreground rounded-md px-2 py-1 text-[10px] font-semibold uppercase">
                Agent
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChannelAgentsPanel({
  agentIds,
  canManage,
  onManage,
}: {
  agentIds: readonly string[];
  canManage: boolean;
  onManage: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Agents & apps</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            Agents with access to this channel and its conversation.
          </p>
        </div>
        {canManage ? (
          <Button size="sm" type="button" variant="outline" onClick={onManage}>
            Manage agents
          </Button>
        ) : null}
      </div>
      <div className="border-border/70 bg-muted/25 divide-y overflow-hidden rounded-2xl border">
        {agentIds.length > 0 ? (
          agentIds.map((agentId) => {
            const identity = getAgentIdentity(agentId);
            return (
              <div key={agentId} className="flex items-center gap-3 px-4 py-4">
                <AgentAvatar
                  label={identity.name}
                  className="size-10 rounded-xl"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">
                      {identity.name}
                    </p>
                    <span className="bg-background/45 text-muted-foreground rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase">
                      Agent
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-0.5 truncate text-xs">
                    {identity.role}
                  </p>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <Bot className="text-muted-foreground size-5" />
            <p className="mt-3 text-sm font-medium">No agents added</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Add an agent when this channel needs specialist help.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
