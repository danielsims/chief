import type { ActionItem } from "@chief/agent-runtime/types";

import {
  isQuestionActionRequest,
  simpleDecisionQuestion,
} from "../../lib/input-request-presentation";
import {
  isWorkspaceAgentId,
  WORKSPACE_AGENT_IDENTITIES,
} from "../../lib/workspace-channels";
import { AttentionPill } from "../attention-pill";
import { InputRequestSection } from "../integrations/input-request-section";

function actionAgentName(agentId: string) {
  return isWorkspaceAgentId(agentId)
    ? WORKSPACE_AGENT_IDENTITIES[agentId].name
    : agentId;
}

/** One durable action presentation shared by main chats and thread panels. */
export function ActionRequestCard({
  action,
  currentUser,
  onSubmit,
}: {
  action: ActionItem;
  currentUser?: { id: string; image?: string } | null;
  onSubmit: (
    requestId: string,
    answers: Record<string, string>,
    values: Record<string, string>,
  ) => Promise<void>;
}) {
  const request = action.request;
  if (!request) return null;
  const simpleDecision = simpleDecisionQuestion(request);
  const questionAction = isQuestionActionRequest(request);

  return (
    <section
      id={`chief-message-${action.id}`}
      className="bg-card/70 mx-auto my-2 w-full max-w-3xl rounded-xl border p-4"
    >
      {action.status === "open" ? <AttentionPill className="mb-3" /> : null}
      <p className="text-[14px] leading-5 font-medium">
        {simpleDecision?.question ?? action.title}
      </p>
      {!questionAction && action.reason ? (
        <p className="text-muted-foreground mt-1 text-xs leading-5">
          {action.reason}
        </p>
      ) : null}
      <div className="mt-3">
        <InputRequestSection
          request={request}
          embedded
          compactDecision={questionAction}
          compactDecisionAgentName={
            questionAction ? actionAgentName(action.agentId) : undefined
          }
          compactDecisionHideQuestionLabels={Boolean(simpleDecision)}
          compactDecisionResolution={action.resolution}
          compactDecisionCurrentUser={currentUser}
          compactDecisionSurface="thread"
          onSubmit={(resolvedRequest, values, answers) =>
            onSubmit(resolvedRequest.id, answers, values)
          }
        />
      </div>
    </section>
  );
}

export function TimelineActionRequestCard({
  action,
  currentUser,
  resolve,
}: {
  action: ActionItem;
  currentUser?: { id: string; image?: string } | null;
  resolve: (
    actionId: string,
    requestId: string,
    answers: Record<string, string>,
    values: Record<string, string>,
  ) => Promise<void>;
}) {
  return (
    <ActionRequestCard
      action={action}
      currentUser={currentUser}
      onSubmit={(requestId, answers, values) =>
        resolve(action.id, requestId, answers, values)
      }
    />
  );
}
