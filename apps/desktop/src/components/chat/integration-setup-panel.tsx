import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

import { Button } from "@chief/ui/components/button";

import type { SetupResult } from "../../lib/integration-setup";
import {
  findPendingInputRequest,
  parseSetupResult,
  withoutMarkerLines,
} from "../../lib/integration-setup";
import { messageBlocks, useChiefChat, useRuntime } from "../../lib/runtime";
import { InputRequestSection } from "../integrations/input-request-section";
import { ApprovalCard } from "./approval-card";
import { Blocks } from "./message-blocks";

/**
 * Inline agent session that performs an integration's setup and streams its
 * work terminal-style. Fires onResult when the agent emits the verified
 * CHIEF_SETUP_RESULT line.
 */
export function IntegrationSetupPanel({
  prompt,
  onResult,
}: {
  prompt: string;
  onResult: (result: SetupResult) => void;
}) {
  const { status: runtimeStatus } = useRuntime();
  const [chatId] = useState(() => crypto.randomUUID());
  const {
    messages,
    controls,
    sendMessage,
    interrupt,
    respondPermission,
    provideInput,
    chatReady,
  } = useChiefChat(chatId);
  const [draft, setDraft] = useState("");
  const [answeredInputs, setAnsweredInputs] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const pendingInput = useMemo(
    () => findPendingInputRequest(messages, answeredInputs),
    [messages, answeredInputs],
  );
  // Once the user opts in, remaining approvals in this run auto-allow.
  const [allowRest, setAllowRest] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const reportedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!allowRest) return;
    for (const approval of controls.approvals) {
      respondPermission(approval.requestId, "allow");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowRest, controls.approvals]);

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
      startedRef.current = true;
      // A replayed transcript means setup already ran in this session —
      // don't kick it off again on top of the resumed history.
      if (messages.length === 0 && controls.status !== "running") {
        void sendMessage({
          text: `Set up this integration. Consult the setup specialist.\n\n${prompt}`,
        });
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeStatus, chatReady, messages.length, controls.status]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages.length, controls.approvals.length, pendingInput]);

  useEffect(() => {
    for (const item of messages) {
      if (item.role !== "assistant") continue;
      for (const block of messageBlocks(item)) {
        if (block.type !== "text") continue;
        const result = parseSetupResult(block.text);
        if (!result) continue;
        const key = JSON.stringify(result);
        if (reportedRef.current.has(key)) continue;
        reportedRef.current.add(key);
        onResult(result);
      }
    }
  }, [messages, onResult]);

  const items = useMemo(
    () =>
      messages.map((item) =>
        item.role === "assistant"
          ? {
              ...item,
              // Setup keeps the narration and ❯ command lines; raw command
              // output stays out of this compact panel (full chats show it).
              blocks: withoutMarkerLines(messageBlocks(item)).filter(
                (block) => block.type !== "tool_result",
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
          className="max-h-72 space-y-3 overflow-y-auto px-3 py-3"
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
                  block.type === "text" && block.text.startsWith("[auto]"),
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
          {!allowRest
            ? controls.approvals.map((approval) => (
                <ApprovalCard
                  key={approval.requestId}
                  approval={approval}
                  onRespond={respondPermission}
                  onAllowAll={() => setAllowRest(true)}
                />
              ))
            : null}
          {controls.status === "running" && controls.approvals.length === 0 ? (
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

      {pendingInput ? (
        <InputRequestSection
          request={pendingInput}
          onSubmit={(request, values) => {
            provideInput(request, values);
            setAnsweredInputs((s) => new Set(s).add(request.id));
          }}
        />
      ) : null}
    </div>
  );
}
