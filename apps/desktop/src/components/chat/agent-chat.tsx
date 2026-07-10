import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import type {
  AgentDefinition,
  DriverType,
} from "@marketer/agent-runtime/types";
import { Button } from "@marketer/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@marketer/ui/components/select";
import { useAgentChat, useProviderModels, useRuntime } from "../../lib/runtime";
import { useAuth } from "../../lib/auth/auth-context";
import { useAgentConfig } from "../../lib/agent-config";
import { PROVIDER_META } from "../../lib/providers";
import {
  findPendingInputRequest,
  withoutMarkerLines,
} from "../../lib/integration-setup";
import { ApprovalCard } from "./approval-card";
import { QuestionCard } from "./question-card";
import { InputRequestSection } from "../integrations/input-request-section";
import { Blocks } from "./message-blocks";
import { StreamingMarkdown } from "./streaming-markdown";

// The local runtime only runs CLI-backed providers.
const CHAT_PROVIDERS: DriverType[] = ["claude", "codex", "opencode"];

const CHAT_SUGGESTIONS: Record<string, string[]> = {
  analyst: [
    "What changed this week?",
    "Where is traffic coming from?",
    "What should we improve next?",
  ],
  cmo: [
    "What should we focus on this week?",
    "Review our current marketing plan",
    "Where are we losing momentum?",
  ],
  "content-writer": [
    "Draft this week's lead post",
    "Turn an insight into a post",
    "Suggest three content angles",
  ],
};

export function AgentChat({
  agent,
  chatId,
  isNew,
  initialPrompt,
  initialDraft,
  initialDriver,
  initialModel,
  integrations,
  onInitialPromptSent,
}: {
  agent: AgentDefinition;
  chatId: string;
  /** True for a draft chat with no persisted transcript to replay. */
  isNew?: boolean;
  initialPrompt?: string;
  initialDraft?: string;
  initialDriver?: DriverType;
  initialModel?: string;
  integrations?: string[];
  onInitialPromptSent?: () => void;
}) {
  const { status: runtimeStatus, client } = useRuntime();
  const { cloudOrganizationId } = useAuth();
  const agentConfig = useAgentConfig();
  const resolved = agentConfig.forAgent(agent.id);
  // The user's explicit in-chat choice wins; otherwise the chat record's
  // saved provider; otherwise the global agent config (Agent settings >
  // workspace provider). Derived, not cached — so a chat mounted before the
  // config resolves picks it up the moment it arrives instead of asking.
  const [chosenDriver, setChosenDriver] = useState<DriverType | null>(null);
  const [chosenModel, setChosenModel] = useState<string | null>(null);
  const driver = chosenDriver ?? initialDriver ?? resolved.driver;
  const model = chosenModel ?? initialModel ?? resolved.model;
  const activeCapabilities = resolved.capabilities ?? agent.capabilities;
  const providerModels = useProviderModels(driver);
  const {
    chat,
    send: sendRaw,
    interrupt,
    respondPermission,
    respondQuestion,
    provideInput,
    sessionReady,
    executorCapability,
  } = useAgentChat(
    agent.id,
    driver,
    chatId,
    agentConfig.access,
    model || undefined,
    activeCapabilities,
    integrations,
  );
  const [answeredInputs, setAnsweredInputs] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const pendingInput = useMemo(
    () => findPendingInputRequest(chat.items, answeredInputs),
    [chat.items, answeredInputs],
  );
  const hasActiveTool = useMemo(
    () =>
      chat.items.some(
        (item) =>
          item.kind === "assistant" &&
          item.event.content.some(
            (block) =>
              block.type === "tool_use" &&
              !item.event.content.some(
                (candidate) =>
                  candidate.type === "tool_result" &&
                  candidate.tool_use_id === block.id,
              ),
          ),
      ),
    [chat.items],
  );
  const send = (text: string) => {
    sendRaw(text);
  };
  const [draft, setDraft] = useState(initialDraft ?? "");
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
        onInitialPromptSent?.();
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
  const activeModel =
    providerModels.models.find((option) => option.value === model)?.label ??
    (model || "Auto");
  const suggestions = CHAT_SUGGESTIONS[agent.id] ?? [];

  const savePreferences = (nextDriver: DriverType, nextModel: string) => {
    if (!cloudOrganizationId || !executorCapability) return;
    client.send({
      type: "setChatPreferences",
      workspaceId: cloudOrganizationId,
      chatId,
      driver: nextDriver,
      model: nextModel || undefined,
      executorCapability,
    });
  };

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="min-w-0 flex-1 space-y-6 overflow-x-hidden overflow-y-auto py-6 pr-2">
        {/* A new chat has nothing to replay, so its identity header renders
            immediately; existing chats wait for history so the empty state
            never flashes before the transcript. */}
        {(sessionReady || isNew) &&
        chat.items.length === 0 &&
        !chat.streaming ? (
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
        ) : null}
        {chat.items.map((item, i) =>
          item.kind === "user" ? (
            <div
              key={i}
              className="mx-auto flex w-full min-w-0 max-w-3xl justify-end"
            >
              <div className="max-w-[80%] whitespace-pre-wrap break-all border bg-accent px-3 py-2 text-sm [overflow-wrap:anywhere]">
                {item.text}
              </div>
            </div>
          ) : (
            <div key={i} className="mx-auto w-full min-w-0 max-w-3xl">
              <Blocks
                blocks={withoutMarkerLines(item.event.content)}
                progress={chat.toolProgress}
                capabilities={activeCapabilities}
              />
            </div>
          ),
        )}
        {chat.streaming ? (
          <div className="chat-markdown mx-auto w-full min-w-0 max-w-3xl overflow-hidden text-sm leading-6 [overflow-wrap:anywhere]">
            <StreamingMarkdown streaming>{chat.streaming}</StreamingMarkdown>
          </div>
        ) : null}
        {chat.approvals.map((approval) => (
          <div key={approval.requestId} className="mx-auto max-w-3xl">
            <ApprovalCard approval={approval} onRespond={respondPermission} />
          </div>
        ))}
        {chat.questions.map((pending) => (
          <div key={pending.requestId} className="mx-auto max-w-3xl">
            <QuestionCard
              pending={pending}
              onSubmit={(answers) =>
                respondQuestion(pending.requestId, answers)
              }
              onDismiss={() => respondQuestion(pending.requestId, null)}
            />
          </div>
        ))}
        {pendingInput ? (
          <div className="mx-auto max-w-3xl">
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
          !hasActiveTool &&
          chat.approvals.length === 0 && (
            <div className="mx-auto w-full max-w-3xl">
              <p className="agent-working font-mono text-xs">working…</p>
            </div>
          )}
        {chat.error && (
          <p className="mx-auto max-w-3xl border border-destructive/40 px-3 py-2 text-xs text-destructive">
            {chat.error}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mx-auto w-full max-w-3xl space-y-2">
        {suggestions.length > 0 && chat.status !== "running" ? (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setDraft(suggestion)}
                className="border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
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
                onValueChange={(value) => {
                  const next = value as DriverType;
                  setChosenDriver(next);
                  setChosenModel("");
                  savePreferences(next, "");
                }}
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
              {driver ? (
                <>
                  <span className="text-xs text-muted-foreground/50">/</span>
                  <Select
                    value={model || "__auto__"}
                    onValueChange={(value) => {
                      const next = value === "__auto__" ? "" : value;
                      setChosenModel(next);
                      savePreferences(driver, next);
                    }}
                  >
                    <SelectTrigger className="h-6 w-auto max-w-48 gap-1.5 border-transparent px-1 text-xs text-muted-foreground hover:text-foreground data-[state=open]:text-foreground">
                      <span className="truncate">
                        {providerModels.loading
                          ? "Loading models…"
                          : activeModel}
                      </span>
                    </SelectTrigger>
                    <SelectContent className="max-h-72 min-w-56">
                      {(providerModels.models.length > 0
                        ? providerModels.models
                        : [{ value: "", label: "Auto" }]
                      ).map((option) => (
                        <SelectItem
                          key={option.value || "auto"}
                          value={option.value || "__auto__"}
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : null}
            </div>
            {chat.status === "running" ? (
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={interrupt}
              >
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
    </div>
  );
}
