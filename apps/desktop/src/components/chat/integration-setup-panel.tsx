import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

import { Button } from "@chief/ui/components/button";

import type { SetupResult } from "../../lib/integration-setup";
import { useAuth } from "../../lib/auth/auth-context";
import {
  findPendingInputRequest,
  latestSetupAttempt,
  SETUP_ATTEMPT_PREFIX,
  setupResultMatchesIntegration,
  withoutMarkerLines,
} from "../../lib/integration-setup";
import {
  messageBlocks,
  useIntegrationSetupChat,
  useRuntime,
} from "../../lib/runtime";
import { InputRequestSection } from "../integrations/input-request-section";
import { ApprovalCard } from "./approval-card";
import { Blocks } from "./message-blocks";
import { QuestionCard } from "./question-card";

/**
 * Inline direct setup session for integrations without a deterministic Chief
 * connector. It never delegates through another agent and resumes by provider.
 */
export function IntegrationSetupPanel({
  sessionKey,
  prompt,
  onResult,
}: {
  sessionKey: string;
  prompt: string;
  onResult: (result: SetupResult) => void;
}) {
  const { status: runtimeStatus } = useRuntime();
  const { cloudOrganizationId } = useAuth();
  const workspaceKey = (cloudOrganizationId ?? "pending")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase();
  const chatId = `integration-setup-v4-${workspaceKey}-${sessionKey.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const {
    messages,
    controls,
    sendMessage,
    interrupt,
    respondPermission,
    respondQuestion,
    provideInput,
    chatReady,
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
  const reportedRef = useRef<Set<string>>(new Set());
  const latestAttempt = useMemo(() => latestSetupAttempt(messages), [messages]);

  useEffect(() => {
    // Kick off only after the runtime confirms the session is open, so the
    // prompt can't race the async session start.
    if (startedRef.current || runtimeStatus !== "connected" || !chatReady) {
      return;
    }
    // Deferred so a StrictMode remount (which cancels the timer) doesn't
    // permanently swallow the kickoff prompt.
    const t = setTimeout(() => {
      if (startedRef.current) return;
      if (latestAttempt && !latestAttempt.result && !controls.error) {
        acceptedAttemptRef.current = latestAttempt.id;
        startedRef.current = true;
        return;
      }
      if (controls.status === "running" || pendingInput) return;
      const attemptId = crypto.randomUUID();
      acceptedAttemptRef.current = attemptId;
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
  ]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages.length, controls.approvals.length, pendingInput]);

  useEffect(() => {
    if (
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

  const items = useMemo(
    () =>
      messages.map((item) =>
        item.role === "assistant"
          ? {
              ...item,
              // Setup shows narration only. The full tool transcript is useful
              // for diagnostics, not while the user is completing a connection.
              blocks: withoutMarkerLines(messageBlocks(item)).filter(
                (block) =>
                  block.type !== "tool_use" && block.type !== "tool_result",
              ),
            }
          : item,
      ),
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
    <div className="space-y-3">
      <div className="bg-background border">
        <div
          ref={feedRef}
          className={`${pendingInput ? "max-h-32" : "max-h-72"} space-y-3 overflow-y-auto px-3 py-3`}
        >
          {items.length === 0 ? (
            <p className="text-muted-foreground animate-pulse font-mono text-xs">
              starting setup…
            </p>
          ) : null}
          {items.map((item, i) =>
            item.role === "user" ? (
              i === 0 ||
              messageBlocks(item).some(
                (block) =>
                  block.type === "text" &&
                  (block.text.startsWith("[auto]") ||
                    block.text.startsWith(SETUP_ATTEMPT_PREFIX)),
              ) ? null : (
                <div key={i} className="flex justify-end">
                  <div className="bg-accent max-w-[85%] border px-2.5 py-1.5 text-xs whitespace-pre-wrap">
                    {messageBlocks(item)
                      .flatMap((block) =>
                        block.type === "text" ? [block.text] : [],
                      )
                      .join("\n")}
                  </div>
                </div>
              )
            ) : "blocks" in item ? (
              <div key={i} className="text-sm">
                <Blocks blocks={item.blocks} />
              </div>
            ) : null,
          )}
          {controls.approvals.map((approval) => (
            <ApprovalCard
              key={approval.requestId}
              approval={approval}
              onRespond={respondPermission}
            />
          ))}
          {controls.questions.map((pending) => (
            <QuestionCard
              key={pending.requestId}
              pending={pending}
              onSubmit={(answers) =>
                respondQuestion(pending.requestId, answers)
              }
              onDismiss={() => respondQuestion(pending.requestId, null)}
            />
          ))}
          {controls.status === "running" &&
          controls.approvals.length === 0 &&
          controls.questions.length === 0 ? (
            <p className="text-muted-foreground animate-pulse font-mono text-xs">
              working…
            </p>
          ) : null}
          {controls.error ? (
            <p className="border-destructive/40 text-destructive border px-2.5 py-1.5 text-xs">
              {controls.error}
            </p>
          ) : null}
        </div>
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
      </div>

      {pendingInput && pendingInput.id !== submittedInputId ? (
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
      ) : null}
    </div>
  );
}
