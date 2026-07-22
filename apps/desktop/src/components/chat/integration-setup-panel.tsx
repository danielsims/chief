import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

import { Button } from "@chief/ui/components/button";

import type { SetupResult } from "../../lib/integration-setup";
import { useAuth } from "../../lib/auth/auth-context";
import {
  findPendingInputRequest,
  integrationProviderMatchesDomain,
  integrationSetupChatId,
  latestSetupAttempt,
  SETUP_ATTEMPT_PREFIX,
  setupResultMatchesIntegration,
  withoutMarkerLines,
} from "../../lib/integration-setup";
import {
  messageBlocks,
  useIntegrationSetupChat,
  useLocalIntegrationStatus,
  useRuntime,
  useWorkspaceData,
} from "../../lib/runtime";
import { InputRequestSection } from "../integrations/input-request-section";
import { AgentWorkingIndicator } from "./agent-working-indicator";
import { ApprovalCard } from "./approval-card";
import { ChatComposer } from "./chat-composer";
import { Blocks } from "./message-blocks";
import { QuestionCard } from "./question-card";
import { SetupProgressList } from "./setup-progress-list";
import { ordinaryToolMessageGroups } from "./specialist-task-display";
import { ToolActivityGroup } from "./tool-activity-group";
import { UserMessage } from "./user-message";

/**
 * Inline direct setup session for integrations without a deterministic Chief
 * connector. It never delegates through another agent and resumes by provider.
 */
export function IntegrationSetupPanel({
  sessionKey,
  prompt,
  onResult,
  chatId: providedChatId,
  actionId,
  standalone = false,
}: {
  sessionKey: string;
  prompt: string;
  onResult?: (result: SetupResult) => void;
  chatId?: string;
  actionId?: string;
  standalone?: boolean;
}) {
  const {
    status: runtimeStatus,
    openBrowser,
    integrationSetupProgress,
  } = useRuntime();
  const { cloudOrganizationId } = useAuth();
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const { integrations: localIntegrations } = useLocalIntegrationStatus();
  const chatId = providedChatId ?? integrationSetupChatId(sessionKey);
  const action = actionId
    ? workspaceData.actionItems.find((item) => item.id === actionId)
    : undefined;
  const {
    messages,
    controls,
    sendMessage,
    interrupt,
    respondPermission,
    respondQuestion,
    provideInput,
    chatReady,
    execution,
  } = useIntegrationSetupChat(chatId, sessionKey);
  const [draft, setDraft] = useState("");
  const [submittedInputId, setSubmittedInputId] = useState<string | null>(null);
  const pendingInput = useMemo(
    () => findPendingInputRequest(messages, new Set()),
    [messages],
  );
  const feedRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const acceptedAttemptRef = useRef<string | null>(null);
  const launchedAttemptRef = useRef<string | null>(null);
  const autoContinuedAttemptsRef = useRef<Set<string>>(new Set());
  const reportedRef = useRef<Set<string>>(new Set());
  const latestAttempt = useMemo(() => latestSetupAttempt(messages), [messages]);
  const setupProgress = integrationSetupProgress[chatId];
  const integrationConnected =
    localIntegrations?.some(
      (integration) =>
        integration.status === "connected" &&
        integrationProviderMatchesDomain(integration.provider, sessionKey),
    ) ?? false;
  const setupComplete =
    integrationConnected || setupProgress?.status === "complete";

  useEffect(() => {
    // Kick off only after the runtime confirms the session is open, so the
    // prompt can't race the async session start.
    if (
      startedRef.current ||
      runtimeStatus !== "connected" ||
      !chatReady ||
      localIntegrations === null
    ) {
      return;
    }
    if (integrationConnected) {
      startedRef.current = true;
      return;
    }
    // Deferred so a StrictMode remount (which cancels the timer) doesn't
    // permanently swallow the kickoff prompt.
    const t = setTimeout(() => {
      if (startedRef.current) return;
      if (latestAttempt && !controls.error) {
        acceptedAttemptRef.current = latestAttempt.id;
        startedRef.current = true;
        return;
      }
      if (controls.status === "running" || pendingInput) return;
      const attemptId = actionId ?? crypto.randomUUID();
      acceptedAttemptRef.current = attemptId;
      launchedAttemptRef.current = attemptId;
      startedRef.current = true;
      void sendMessage({
        text: `${SETUP_ATTEMPT_PREFIX}${attemptId}]\nSet up this integration directly. Do not delegate this work to another agent.\n\n${prompt}`,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [
    runtimeStatus,
    chatReady,
    controls.error,
    controls.status,
    latestAttempt,
    pendingInput,
    prompt,
    sendMessage,
    actionId,
    integrationConnected,
    localIntegrations,
  ]);

  useEffect(() => {
    const attemptId = launchedAttemptRef.current;
    if (
      !attemptId ||
      autoContinuedAttemptsRef.current.has(attemptId) ||
      latestAttempt?.id !== attemptId ||
      latestAttempt.result ||
      controls.status !== "idle" ||
      controls.error ||
      controls.approvals.length > 0 ||
      controls.questions.length > 0 ||
      pendingInput
    ) {
      return;
    }
    const marker = `${SETUP_ATTEMPT_PREFIX}${attemptId}]`;
    const attemptStart = messages.findIndex(
      (message) =>
        message.role === "user" &&
        messageBlocks(message).some(
          (block) => block.type === "text" && block.text.startsWith(marker),
        ),
    );
    if (attemptStart < 0) return;
    const attemptMessages = messages.slice(attemptStart + 1);
    const hasAssistantText = attemptMessages.some(
      (message) =>
        message.role === "assistant" &&
        messageBlocks(message).some(
          (block) => block.type === "text" && block.text.trim().length > 0,
        ),
    );
    const hasToolActivity = attemptMessages.some((message) =>
      messageBlocks(message).some(
        (block) => block.type === "tool_use" || block.type === "tool_result",
      ),
    );
    if (!hasAssistantText || hasToolActivity) return;
    autoContinuedAttemptsRef.current.add(attemptId);
    const timer = window.setTimeout(() => {
      void sendMessage({
        text: "[auto] Continue the active setup now. Do not repeat narration or wait for another message; make the first required setup tool call.",
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    controls.approvals.length,
    controls.error,
    controls.questions.length,
    controls.status,
    latestAttempt,
    messages,
    pendingInput,
    sendMessage,
  ]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages.length, controls.approvals.length, pendingInput]);

  useEffect(() => {
    if (
      !onResult ||
      !latestAttempt?.result ||
      !setupResultMatchesIntegration(latestAttempt.result, sessionKey) ||
      acceptedAttemptRef.current !== latestAttempt.id
    ) {
      return;
    }
    const key = `${latestAttempt.id}:${JSON.stringify(latestAttempt.result)}`;
    if (reportedRef.current.has(key)) return;
    reportedRef.current.add(key);
    onResult(latestAttempt.result);
  }, [latestAttempt, onResult, sessionKey]);

  const ordinaryToolGroups = ordinaryToolMessageGroups(
    messages.map((message) => ({
      id: message.id,
      role: message.role,
      blocks: withoutMarkerLines(messageBlocks(message)),
    })),
    [],
  );
  const hasActiveTool = useMemo(
    () =>
      messages.some((message) => {
        if (message.role !== "assistant") return false;
        const blocks = withoutMarkerLines(messageBlocks(message));
        return blocks.some(
          (block) =>
            block.type === "tool_use" &&
            !blocks.some(
              (candidate) =>
                candidate.type === "tool_result" &&
                candidate.tool_use_id === block.id,
            ),
        );
      }),
    [messages],
  );

  const submit = () => {
    const text = draft.trim();
    if (!text || !chatReady) return;
    setDraft("");
    void sendMessage({ text });
  };

  if (runtimeStatus !== "connected") {
    return (
      <div className="text-muted-foreground border border-dashed px-3 py-2 text-xs">
        Waiting for the local agent service before setup can start.
      </div>
    );
  }

  return (
    <div
      className={
        standalone
          ? "flex h-full min-h-0 flex-col gap-3 overflow-hidden py-6 pr-2"
          : "space-y-3"
      }
    >
      {standalone &&
      sessionKey === "analytics.googleapis.com" &&
      localIntegrations !== null &&
      !setupComplete ? (
        <SetupProgressList progress={setupProgress} />
      ) : null}
      <div
        className={
          standalone ? "flex min-h-0 flex-1 flex-col" : "bg-background border"
        }
      >
        <div
          ref={feedRef}
          className={
            standalone
              ? "min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto py-3 pr-2"
              : `${pendingInput ? "max-h-32" : "max-h-72"} space-y-3 overflow-y-auto px-3 py-3`
          }
        >
          {messages.length === 0 && !controls.error ? (
            !standalone && sessionKey === "analytics.googleapis.com" ? (
              <p className="text-muted-foreground text-xs leading-5">
                Sign in with the Google account that has access to the Analytics
                property you want to connect. It may be different from your
                Chief account.
              </p>
            ) : (
              <div className="mx-auto w-full max-w-3xl">
                <AgentWorkingIndicator />
              </div>
            )
          ) : null}
          {messages.map((message) => {
            const blocks = withoutMarkerLines(messageBlocks(message));
            if (message.role === "user") {
              const hidden = blocks.some(
                (block) =>
                  block.type === "text" &&
                  (block.text.startsWith("[auto]") ||
                    block.text.startsWith(SETUP_ATTEMPT_PREFIX)),
              );
              const text = blocks
                .flatMap((block) => (block.type === "text" ? [block.text] : []))
                .join("\n");
              return hidden || !text.trim() ? null : (
                <UserMessage key={message.id} text={text} />
              );
            }
            if (message.role !== "assistant" || blocks.length === 0) {
              return null;
            }
            const toolGroup = ordinaryToolGroups.get(message.id);
            if (toolGroup) {
              if (toolGroup.ownerId !== message.id) return null;
              return (
                <div
                  key={message.id}
                  className="mx-auto w-full max-w-3xl min-w-0"
                >
                  <ToolActivityGroup
                    blocks={toolGroup.blocks}
                    progress={controls.toolProgress}
                    active={controls.status === "running"}
                  />
                </div>
              );
            }
            return (
              <div
                key={message.id}
                className="mx-auto w-full max-w-3xl min-w-0"
              >
                <Blocks
                  blocks={blocks}
                  progress={controls.toolProgress}
                  active={controls.status === "running"}
                />
              </div>
            );
          })}
          {controls.approvals.map((approval) => (
            <div key={approval.requestId} className="mx-auto w-full max-w-3xl">
              <ApprovalCard approval={approval} onRespond={respondPermission} />
            </div>
          ))}
          {controls.questions.map((pending) => (
            <div key={pending.requestId} className="mx-auto w-full max-w-3xl">
              <QuestionCard
                pending={pending}
                onSubmit={(answers) =>
                  respondQuestion(pending.requestId, answers)
                }
                onDismiss={() => respondQuestion(pending.requestId, null)}
              />
            </div>
          ))}
          {controls.status === "running" &&
          !hasActiveTool &&
          controls.approvals.length === 0 &&
          controls.questions.length === 0 ? (
            <div className="mx-auto w-full max-w-3xl">
              <AgentWorkingIndicator />
            </div>
          ) : null}
          {controls.error ? (
            <p className="border-destructive/40 text-destructive mx-auto w-full max-w-3xl border px-3 py-2 text-xs">
              Setup couldn’t start. Refresh to try again.
            </p>
          ) : null}
        </div>
        {standalone ? (
          <ChatComposer
            className="mx-auto w-full max-w-3xl"
            value={draft}
            onValueChange={setDraft}
            onSubmit={submit}
            execution={execution}
            running={controls.status === "running"}
            onInterrupt={interrupt}
            showSuggestions={false}
            showExecutionControls={false}
          />
        ) : (
          <div className="flex items-center gap-2 border-t px-2 py-1.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Reply to Chief…"
              className="placeholder:text-muted-foreground h-7 min-w-0 flex-1 bg-transparent px-1 text-xs outline-none"
            />
            {controls.status === "running" ? (
              <Button
                size="icon"
                variant="outline"
                className="h-6 w-6"
                onClick={interrupt}
              >
                <Square size={10} />
              </Button>
            ) : (
              <Button size="icon" className="h-6 w-6" onClick={submit}>
                <ArrowUp size={12} />
              </Button>
            )}
          </div>
        )}
      </div>

      {action?.request && !actionId && chatReady ? (
        <div className={standalone ? "mx-auto w-full max-w-3xl" : undefined}>
          <InputRequestSection
            request={action.request}
            embedded
            progressive
            onOpenUrl={(url) => openBrowser(url, chatId)}
            onSubmit={(request, values, answers) =>
              workspaceData.resolveActionRequest(
                action.id,
                request.id,
                answers,
                values,
                { chatId, domain: sessionKey },
              )
            }
          />
        </div>
      ) : pendingInput && pendingInput.id !== submittedInputId ? (
        <div className={standalone ? "mx-auto w-full max-w-3xl" : undefined}>
          <InputRequestSection
            request={pendingInput}
            onSubmit={(request, values) => {
              provideInput(
                {
                  ...request,
                  id: `${request.id}:${acceptedAttemptRef.current ?? crypto.randomUUID()}:${crypto.randomUUID()}`,
                },
                values,
              );
              setSubmittedInputId(request.id);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
