import type { ReactNode } from "react";
import { memo, useMemo } from "react";

import type {
  AgentCapabilityId,
  ChiefMessageMetadata,
  ChiefUIMessage,
  ContentBlock,
  SessionRecord,
} from "@chief/agent-runtime/types";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import type { ConversationProfileSelection } from "./conversation-profile";
import { browserOpenResultContent } from "../../lib/browser-sessions";
import {
  channelMembershipTargetNames,
  formatMembershipTargets,
} from "../../lib/channel-actions";
import { WORKSPACE_AGENT_IDENTITIES } from "../../lib/workspace-channels";
import { AgentAvatar } from "../agent-avatar";
import { Blocks } from "./message-blocks";

const MessageBlocksContent = memo(
  function MessageBlocksContent({
    message,
    filter,
    progress,
    capabilities,
    active,
    tasks,
    taskOwners,
    ownerId,
    onOpenTask,
  }: {
    message: ChiefUIMessage;
    filter: (message: ChiefUIMessage) => ContentBlock[];
    progress?: Record<string, string>;
    capabilities?: readonly AgentCapabilityId[];
    active?: boolean;
    tasks?: readonly SessionRecord[];
    taskOwners?: ReadonlyMap<string, string>;
    ownerId?: string;
    onOpenTask?: (taskId: string) => void;
  }) {
    const blocks = useMemo(() => filter(message), [filter, message]);
    return (
      <Blocks
        blocks={blocks}
        progress={progress}
        capabilities={capabilities}
        active={active}
        tasks={tasks}
        taskOwners={taskOwners}
        ownerId={ownerId}
        onOpenTask={onOpenTask}
      />
    );
  },
  (prev, next) => {
    if (prev.message !== next.message) return false;
    if (prev.filter !== next.filter) return false;
    if (prev.active !== next.active) return false;
    if (prev.capabilities !== next.capabilities) return false;
    if (prev.ownerId !== next.ownerId) return false;
    if (prev.tasks !== next.tasks) return false;
    if (prev.taskOwners !== next.taskOwners) return false;
    if (prev.onOpenTask !== next.onOpenTask) return false;
    return true;
  },
);

/** Muted, Slack-like skeleton shown while a channel's content resolves. */
function ChatSkeleton() {
  return (
    <div
      aria-hidden
      className="mx-auto w-full max-w-3xl space-y-6 py-2"
      data-testid="chat-skeleton"
    >
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-start gap-3">
          <div className="bg-muted/60 size-8 shrink-0 animate-pulse rounded-full" />
          <div className="min-w-0 flex-1 space-y-2 pt-1.5">
            <div className="bg-muted/60 h-2.5 w-40 animate-pulse rounded-md" />
            <div className="bg-muted/60 h-2.5 w-full animate-pulse rounded-md" />
            <div className="bg-muted/40 h-2.5 w-3/4 animate-pulse rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * True only for the tool call that OPENS the browser session. Interactions
 * (snapshot, click, fill, select, press) operate on an already-open browser
 * and must not render a second attachment — otherwise a turn with several
 * browser steps renders one placeholder container per step, with the live
 * viewer only attached to the last.
 */
function isBrowserOpenBlock(block: ContentBlock): boolean {
  if (block.type !== "tool_use") return false;
  const name = block.name.toLowerCase();
  if (
    name === "browser.open" ||
    name === "googleoauth.provisionclient" ||
    name === "googleanalytics.authorize"
  ) {
    return true;
  }
  const code = browserToolCode(block.input);
  return (
    code !== null &&
    (code.includes("browserOpen") ||
      code.includes("browser.open") ||
      code.includes("googleOAuthProvisionClient") ||
      code.includes("googleOAuth.provisionClient") ||
      code.includes("googleAnalyticsAuthorize"))
  );
}

/**
 * The browser-open tool_use block of a message, if any. The input-based check
 * is supplemented by the paired tool result so the executor's `executor_execute`
 * browserOpen call (empty persisted input, `{ opened: true, url }` output) is
 * recognized.
 */
function browserOpenBlockIn(
  blocks: ContentBlock[],
): Extract<ContentBlock, { type: "tool_use" }> | undefined {
  const results = new Map(
    blocks
      .filter(
        (block): block is Extract<ContentBlock, { type: "tool_result" }> =>
          block.type === "tool_result",
      )
      .map((block) => [block.tool_use_id, block]),
  );
  return blocks.find(
    (block): block is Extract<ContentBlock, { type: "tool_use" }> =>
      block.type === "tool_use" &&
      (isBrowserOpenBlock(block) ||
        Boolean(
          results.get(block.id) &&
          browserOpenResultContent(results.get(block.id)?.content),
        )),
  );
}

function browserToolCode(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const candidate = (input as Record<string, unknown>).code;
  if (typeof candidate === "string") {
    if (candidate.includes("tools.") || candidate.includes('tools["')) {
      return candidate;
    }
    return null;
  }
  if (candidate && typeof candidate === "object") {
    const nested = browserToolCode(candidate);
    if (nested !== null) return nested;
  }
  for (const value of Object.values(input as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    if (value.includes("tools.") || value.includes('tools["')) return value;
    const nested = browserToolCode(value);
    if (nested !== null) return nested;
  }
  return null;
}

function ChiefMessage({
  children,
  agent,
  messageId,
  onOpenProfile,
  actions,
  footer,
  metadata,
}: {
  children: ReactNode;
  agent?: { id: WorkspaceAgentId; name: string; role: string };
  messageId?: string;
  onOpenProfile?: (selection: ConversationProfileSelection) => void;
  actions?: ReactNode;
  footer?: ReactNode;
  metadata?: ReactNode;
}) {
  const identity = agent ?? {
    name: "Chief",
    role: "Chief Marketing Officer",
  };
  const agentId = agent?.id ?? "cmo";
  const resolvedMetadata = metadata === undefined ? identity.role : metadata;
  return (
    <div
      id={messageId ? `chief-message-${messageId}` : undefined}
      className="group/message relative mx-auto flex w-full max-w-3xl min-w-0 items-start gap-3 py-2"
    >
      {actions}
      <button
        type="button"
        aria-label={`Open ${identity.name} profile`}
        title={`Open ${identity.name} profile`}
        disabled={!onOpenProfile}
        onClick={() => onOpenProfile?.({ kind: "agent", agentId })}
        className="focus-visible:ring-ring/30 shrink-0 rounded-full transition-opacity outline-none enabled:hover:opacity-85 enabled:focus-visible:ring-2 disabled:cursor-default"
      >
        <AgentAvatar label={identity.name} />
      </button>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 flex items-baseline gap-2">
          <strong className="text-[13px] font-semibold">{identity.name}</strong>
          {resolvedMetadata ? (
            <span className="text-muted-foreground text-[10px]">
              {resolvedMetadata}
            </span>
          ) : null}
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}

function ChannelMembershipMessage({
  action,
  userImage,
}: {
  action: NonNullable<ChiefMessageMetadata["channelAction"]>;
  userImage?: string;
}) {
  const targetNames = channelMembershipTargetNames(action, (agentId) => {
    if (!Object.hasOwn(WORKSPACE_AGENT_IDENTITIES, agentId)) return agentId;
    return WORKSPACE_AGENT_IDENTITIES[agentId as WorkspaceAgentId].name;
  });
  const actorIsAgent = action.actorType === "agent";
  return (
    <div className="text-muted-foreground mx-auto flex w-full max-w-3xl items-center gap-2.5 py-2 pl-11 text-xs">
      {actorIsAgent ? (
        <AgentAvatar
          className="size-5"
          markClassName="size-2.5"
          label={action.actorName}
        />
      ) : (
        <span className="bg-muted flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full text-[8px] font-semibold">
          {userImage ? (
            <img src={userImage} alt="" className="size-full object-cover" />
          ) : (
            action.actorName.charAt(0).toUpperCase()
          )}
        </span>
      )}
      <span>
        <strong className="text-foreground font-medium">
          {action.actorName}
        </strong>{" "}
        added{" "}
        <strong className="text-foreground font-medium">
          {formatMembershipTargets(targetNames)}
        </strong>{" "}
        to the channel
      </span>
    </div>
  );
}

export {
  browserOpenBlockIn,
  ChannelMembershipMessage,
  ChatSkeleton,
  ChiefMessage,
  MessageBlocksContent,
};
