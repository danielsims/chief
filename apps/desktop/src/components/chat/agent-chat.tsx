import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import type { AgentDefinition, DriverType } from "@marketer/agent-runtime/types";
import { Button } from "@marketer/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@marketer/ui/components/select";
import { useAgentChat, useRuntime } from "../../lib/runtime";
import { getAgentOverride, getWorkspaceProvider } from "../../lib/agent-overrides";
import { recordChat } from "../../lib/chat-log";
import { PROVIDER_META } from "../../lib/providers";
import {
  findPendingInputRequest,
  withoutMarkerLines,
} from "../../lib/integration-setup";
import { ApprovalCard } from "./approval-card";
import { InputRequestSection } from "../integrations/input-request-section";
import { Blocks } from "./message-blocks";

// The local runtime only runs CLI-backed providers.
const CHAT_PROVIDERS: DriverType[] = ["claude", "codex"];

export function AgentChat({
  agent,
  initialPrompt,
}: {
  agent: AgentDefinition;
  initialPrompt?: string;
}) {
  const { status: runtimeStatus } = useRuntime();
  // Per-chat provider, resolved per-agent override > workspace provider.
  // Null means the user hasn't chosen an agent app yet — no session opens
  // and the picker asks instead of assuming one.
  const [driver, setDriver] = useState<DriverType | null>(
    () => getAgentOverride(agent.id).driver ?? getWorkspaceProvider(),
  );
  const {
    chat,
    send: sendRaw,
    interrupt,
    respondPermission,
    provideInput,
    sessionReady,
  } = useAgentChat(agent.id, driver);
  const [answeredInputs, setAnsweredInputs] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const pendingInput = useMemo(
    () => findPendingInputRequest(chat.items, answeredInputs),
    [chat.items, answeredInputs],
  );
  // Every send updates the local chat log the conversations list is built from.
  const send = (text: string) => {
    recordChat(agent.id, text);
    sendRaw(text);
  };
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.items.length, chat.streaming]);

  useEffect(() => {
    if (
      initialPrompt &&
      !sentInitial.current &&
      driver &&
      sessionReady &&
      runtimeStatus === "connected"
    ) {
      // flag is set inside the timeout so a StrictMode remount (which
      // cancels the timer) doesn't permanently swallow the prompt
      const t = setTimeout(() => {
        if (sentInitial.current) return;
        sentInitial.current = true;
        send(initialPrompt);
      }, 400);
      return () => clearTimeout(t);
    }
  }, [initialPrompt, runtimeStatus, driver, sessionReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (chat.status === "running" || !driver) return;
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    send(text);
  };

  const activeMeta = driver ? PROVIDER_META[driver] : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto py-6 pr-2">
        {chat.items.length === 0 && !chat.streaming && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="font-serif text-3xl">{agent.name}</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {agent.description}
            </p>
            {runtimeStatus !== "connected" && (
              <p className="mt-4 border border-dashed px-3 py-2 text-xs text-muted-foreground">
                Agent runtime not connected. Run <code>pnpm dev</code> in the
                repo root.
              </p>
            )}
          </div>
        )}
        {chat.items.map((item, i) =>
          item.kind === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] border bg-accent px-3 py-2 text-sm whitespace-pre-wrap">
                {item.text}
              </div>
            </div>
          ) : (
            <div key={i} className="max-w-[90%]">
              <Blocks blocks={withoutMarkerLines(item.event.content)} />
            </div>
          ),
        )}
        {chat.streaming && (
          <p className="max-w-[90%] whitespace-pre-wrap text-sm leading-6">
            {chat.streaming}
            <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-foreground align-text-bottom" />
          </p>
        )}
        {chat.approvals.map((approval) => (
          <div key={approval.requestId} className="max-w-[90%]">
            <ApprovalCard approval={approval} onRespond={respondPermission} />
          </div>
        ))}
        {pendingInput ? (
          <div className="max-w-[90%]">
            <InputRequestSection
              request={pendingInput}
              onSubmit={(request, values) => {
                provideInput(request, values);
                setAnsweredInputs((s) => new Set(s).add(request.id));
              }}
            />
          </div>
        ) : null}
        {chat.status === "running" &&
          !chat.streaming &&
          chat.approvals.length === 0 && (
            <p className="font-mono text-xs text-muted-foreground animate-pulse">
              working…
            </p>
          )}
        {chat.error && (
          <p className="border border-destructive/40 px-3 py-2 text-xs text-destructive">
            {chat.error}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border bg-card/80 backdrop-blur-lg">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={`Message ${agent.name}…`}
          rows={2}
          className="w-full resize-none bg-transparent px-3 pt-3 text-sm leading-6 outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-between px-3 pb-2">
          <div className="flex items-center gap-3">
            <Select
              value={driver ?? undefined}
              onValueChange={(value) => setDriver(value as DriverType)}
            >
              <SelectTrigger className="h-6 w-auto gap-1.5 border-transparent px-1 text-xs text-muted-foreground hover:text-foreground data-[state=open]:text-foreground">
                {activeMeta ? (
                  <span className="flex items-center gap-1.5">
                    <activeMeta.Icon size={13} />
                    {activeMeta.label}
                  </span>
                ) : (
                  <span>Choose agent app</span>
                )}
              </SelectTrigger>
              <SelectContent className="min-w-32">
                {CHAT_PROVIDERS.map((value) => {
                  const { label, Icon } = PROVIDER_META[value];
                  return (
                    <SelectItem key={value} value={value}>
                      <span className="flex items-center gap-1.5">
                        <Icon size={13} />
                        {label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {chat.lastCostUsd !== undefined && (
              <span className="text-[11px] text-muted-foreground">
                last turn ${chat.lastCostUsd.toFixed(4)}
              </span>
            )}
          </div>
          {chat.status === "running" ? (
            <Button size="icon" variant="outline" className="h-7 w-7" onClick={interrupt}>
              <Square size={12} />
            </Button>
          ) : (
            <Button size="icon" className="h-7 w-7" onClick={submit}>
              <ArrowUp size={14} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
