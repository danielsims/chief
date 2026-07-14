import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { DriverType } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { useAgentChat, useRuntime } from "../../lib/runtime";
import {
  SETUP_AGENT_ID,
  findPendingInputRequest,
  parseSetupResult,
  setupChatId,
  stripSetupResult,
  withoutMarkerLines,
  type SetupResult,
} from "../../lib/integration-setup";
import { ApprovalCard } from "./approval-card";
import { InputRequestSection } from "../integrations/input-request-section";
import { Blocks } from "./message-blocks";

/**
 * Inline agent session that performs an integration's setup and streams its
 * work terminal-style. Fires onResult when the agent emits the verified
 * CHIEF_SETUP_RESULT line.
 */
export function IntegrationSetupPanel({
  domain,
  prompt,
  driver,
  onResult,
}: {
  domain: string;
  prompt: string;
  /** The workspace's chosen agent app — required, never defaulted here. */
  driver: DriverType;
  onResult: (result: SetupResult) => void;
}) {
  const { status: runtimeStatus } = useRuntime();
  // Setup runs full-access: the user pressed Connect, and the run needs
  // installs, browser opens and localhost callbacks to just work.
  const {
    chat,
    send,
    interrupt,
    respondPermission,
    provideInput,
    sessionReady,
  } = useAgentChat(SETUP_AGENT_ID, driver, setupChatId(domain), "full");
  const [draft, setDraft] = useState("");
  const [answeredInputs, setAnsweredInputs] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const pendingInput = useMemo(
    () => findPendingInputRequest(chat.items, answeredInputs),
    [chat.items, answeredInputs],
  );
  // Once the user opts in, remaining approvals in this run auto-allow.
  const [allowRest, setAllowRest] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const reportedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!allowRest) return;
    for (const approval of chat.approvals) {
      respondPermission(approval.requestId, "allow");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowRest, chat.approvals]);

  useEffect(() => {
    // Kick off only after the runtime confirms the session is open, so the
    // prompt can't race the async session start.
    if (startedRef.current || runtimeStatus !== "connected" || !sessionReady) {
      return;
    }
    // Deferred so a StrictMode remount (which cancels the timer) doesn't
    // permanently swallow the kickoff prompt.
    const t = setTimeout(() => {
      if (startedRef.current) return;
      startedRef.current = true;
      // A replayed transcript means setup already ran in this session —
      // don't kick it off again on top of the resumed history.
      if (chat.items.length === 0 && chat.status !== "running") send(prompt);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeStatus, sessionReady, chat.items.length, chat.status]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [chat.items.length, chat.streaming, chat.approvals.length, pendingInput]);

  useEffect(() => {
    for (const item of chat.items) {
      if (item.kind !== "assistant") continue;
      for (const block of item.event.content) {
        if (block.type !== "text") continue;
        const result = parseSetupResult(block.text);
        if (!result) continue;
        const key = JSON.stringify(result);
        if (reportedRef.current.has(key)) continue;
        reportedRef.current.add(key);
        onResult(result);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.items, onResult]);

  const items = useMemo(
    () =>
      chat.items.map((item) =>
        item.kind === "assistant"
          ? {
              ...item,
              // Setup keeps the narration and ❯ command lines; raw command
              // output stays out of this compact panel (full chats show it).
              blocks: withoutMarkerLines(item.event.content).filter(
                (block) => block.type !== "tool_result",
              ),
            }
          : item,
      ),
    [chat.items],
  );

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    send(text);
  };

  if (runtimeStatus !== "connected") {
    return (
      <div className="border border-dashed px-3 py-2 text-xs text-muted-foreground">
        Waiting for the local agent service before setup can start.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="border bg-background">
        <div
          ref={feedRef}
          className="max-h-72 space-y-3 overflow-y-auto px-3 py-3"
        >
          {items.length === 0 && !chat.streaming ? (
            <p className="animate-pulse font-mono text-xs text-muted-foreground">
              starting setup…
            </p>
          ) : null}
          {items.map((item, i) =>
            item.kind === "user" ? (
              i === 0 || item.text.startsWith("[auto]") ? null : (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] border bg-accent px-2.5 py-1.5 text-xs whitespace-pre-wrap">
                    {item.text}
                  </div>
                </div>
              )
            ) : (
              <div key={i} className="text-sm">
                <Blocks blocks={item.blocks} />
              </div>
            ),
          )}
          {chat.streaming ? (
            <p className="whitespace-pre-wrap text-sm leading-6">
              {stripSetupResult(chat.streaming)}
              <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-foreground align-text-bottom" />
            </p>
          ) : null}
          {!allowRest
            ? chat.approvals.map((approval) => (
                <ApprovalCard
                  key={approval.requestId}
                  approval={approval}
                  onRespond={respondPermission}
                  onAllowAll={() => setAllowRest(true)}
                />
              ))
            : null}
          {chat.status === "running" &&
          !chat.streaming &&
          chat.approvals.length === 0 ? (
            <p className="animate-pulse font-mono text-xs text-muted-foreground">
              working…
            </p>
          ) : null}
          {chat.error ? (
            <p className="border border-destructive/40 px-2.5 py-1.5 text-xs text-destructive">
              {chat.error}
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
            placeholder="Reply to the setup agent…"
            className="h-7 min-w-0 flex-1 bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground"
          />
          {chat.status === "running" ? (
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
