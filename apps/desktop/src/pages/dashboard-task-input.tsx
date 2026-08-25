import { useMemo, useState } from "react";

import type { SessionRecord } from "@chief/agent-runtime/types";

import { InputRequestSection } from "../components/integrations/input-request-section";
import { isQuestionActionRequest } from "../lib/input-request-presentation";
import { findPendingInputRequest } from "../lib/integration-setup";
import { useObservedChat } from "../lib/runtime";

export function DashboardTaskInput({
  agentName,
  task,
}: {
  agentName: string;
  task: SessionRecord;
}) {
  const [answeredInputs, setAnsweredInputs] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const { messages, provideInput, chatReady } = useObservedChat(
    task.id,
    task.scheduleId,
  );
  const pendingInput = useMemo(
    () => findPendingInputRequest(messages, answeredInputs),
    [answeredInputs, messages],
  );

  if (!chatReady) {
    return (
      <p className="text-muted-foreground mt-4 animate-pulse text-xs">
        Loading the task request…
      </p>
    );
  }
  if (!pendingInput) return null;

  return (
    <div className="mt-5 w-full max-w-[620px]">
      <InputRequestSection
        request={pendingInput}
        embedded
        compactDecision={isQuestionActionRequest(pendingInput)}
        compactDecisionAgentName={
          isQuestionActionRequest(pendingInput) ? agentName : undefined
        }
        onSubmit={(request, values) => {
          provideInput(request, values);
          setAnsweredInputs((current) => new Set(current).add(request.id));
        }}
      />
    </div>
  );
}
