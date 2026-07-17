import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

import type { AgentDefinition, DriverType } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";

import type { SchedulingDraft } from "./recurring-work-composer";
import { useAgentConfig } from "../../lib/agent-config";
import {
  getWorkspaceProvider,
  setWorkspaceProvider,
} from "../../lib/agent-overrides";
import { useAuth } from "../../lib/auth/auth-context";
import {
  findPendingInputRequest,
  withoutMarkerLines,
} from "../../lib/integration-setup";
import { PROVIDER_META } from "../../lib/providers";
import {
  useAgentChat,
  useProviderModels,
  useRuntime,
  useWorkspaceData,
} from "../../lib/runtime";
import { InputRequestSection } from "../integrations/input-request-section";
import { ApprovalCard } from "./approval-card";
import { Blocks } from "./message-blocks";
import { QuestionCard } from "./question-card";
import { RecurringWorkComposer } from "./recurring-work-composer";
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

function UserMessage({ text }: { text: string }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 justify-end">
      <div className="chat-markdown bg-accent max-w-[80%] overflow-hidden border px-3 py-2 text-sm leading-6 [overflow-wrap:anywhere]">
        <StreamingMarkdown>{text}</StreamingMarkdown>
      </div>
    </div>
  );
}

export function AgentChat({
  agent,
  chatId,
  isNew,
  composer,
  composerDate,
  composerPlaybookId,
  initialPrompt,
  initialDraft,
  initialDriver,
  initialModel,
  integrations,
  observeOnly = false,
  observationLabel = "Scheduled run · live view",
  observedRecurringWorkId,
  onInitialPromptSent,
}: {
  agent: AgentDefinition;
  chatId: string;
  /** True for a draft chat with no persisted transcript to replay. */
  isNew?: boolean;
  /** Guided inline setup rendered above the message box. */
  composer?: "recurring" | "oneoff";
  /** Prefilled date (YYYY-MM-DD) for the one-off composer. */
  composerDate?: string;
  /** Prefilled playbook for recurring work. */
  composerPlaybookId?: string;
  initialPrompt?: string;
  initialDraft?: string;
  initialDriver?: DriverType;
  initialModel?: string;
  integrations?: string[];
  /** Read-only attachment to an already-running scheduled session. */
  observeOnly?: boolean;
  /** Context shown above a read-only run transcript. */
  observationLabel?: string;
  observedRecurringWorkId?: string;
  onInitialPromptSent?: () => void;
}) {
  const { status: runtimeStatus, client } = useRuntime();
  const { cloudOrganizationId } = useAuth();
  const workspaceData = useWorkspaceData(cloudOrganizationId);
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
    observeOnly,
    observedRecurringWorkId,
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
  const [optimisticInitialPrompt] = useState(() => initialPrompt ?? null);
  const [composerOpen, setComposerOpen] = useState(composer !== undefined);
  const [approveAfterCreation, setApproveAfterCreation] = useState(false);
  const autoApproveRef = useRef<{
    submittedAt: number;
    expiresAt: number;
    existingIds: ReadonlySet<string>;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);

  useEffect(() => {
    const intent = autoApproveRef.current;
    if (!intent) return;
    if (Date.now() > intent.expiresAt) {
      autoApproveRef.current = null;
      return;
    }
    const proposed = workspaceData.recurringWork.find(
      (work) =>
        work.status === "draft" &&
        work.createdAt >= intent.submittedAt &&
        !intent.existingIds.has(work.id),
    );
    if (!proposed) return;
    autoApproveRef.current = null;
    workspaceData.saveRecurringWork({
      ...proposed,
      status: "active",
      grant: {
        version: 1,
        approvedAt: Date.now(),
        toolPatterns: proposed.proposedToolPatterns,
      },
      updatedAt: Date.now(),
    });
    // saveRecurringWork is intentionally invoked once for the proposal that
    // appears after the user's explicit Create as approved submission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceData.recurringWork]);

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
    if (composerOpen && approveAfterCreation) {
      autoApproveRef.current = {
        submittedAt: Date.now(),
        expiresAt: Date.now() + 10 * 60_000,
        existingIds: new Set(
          workspaceData.recurringWork.map((work) => work.id),
        ),
      };
    } else {
      autoApproveRef.current = null;
    }
    setDraft("");
    setComposerOpen(false);
    send(text);
  };

  const composeSchedule = ({
    text,
    approveAfterCreation: nextApproval,
  }: SchedulingDraft) => {
    setDraft(text);
    setApproveAfterCreation(nextApproval);
  };

  const activeMeta = driver ? PROVIDER_META[driver] : null;
  const activeModel =
    providerModels.models.find((option) => option.value === model)?.label ??
    (model || "Auto");
  const suggestions = CHAT_SUGGESTIONS[agent.id] ?? [];
  const showOptimisticInitialPrompt = Boolean(
    optimisticInitialPrompt &&
    !chat.items.some(
      (item) => item.kind === "user" && item.text === optimisticInitialPrompt,
    ),
  );

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
      {observeOnly ? (
        <div className="text-muted-foreground shrink-0 border-b py-2 text-center text-xs">
          {observationLabel}
        </div>
      ) : null}
      <div className="min-w-0 flex-1 space-y-6 overflow-x-hidden overflow-y-auto py-6 pr-2">
        {/* A new chat has nothing to replay, so its identity header renders
            immediately; existing chats wait for history so the empty state
            never flashes before the transcript. */}
        {composerOpen && chat.items.length === 0 && !chat.streaming ? (
          <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center py-6">
            <RecurringWorkComposer
              mode={composer === "oneoff" ? "one-off" : "recurring"}
              date={composerDate}
              playbookId={composerPlaybookId}
              onCompose={composeSchedule}
              onSubmit={submit}
              onDismiss={() => setComposerOpen(false)}
            />
          </div>
        ) : null}
        {(sessionReady || isNew) &&
        !composerOpen &&
        chat.items.length === 0 &&
        !chat.streaming &&
        !showOptimisticInitialPrompt ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="font-serif text-3xl">{agent.name}</p>
            <p className="text-muted-foreground max-w-md text-sm">
              {agent.description}
            </p>
            {runtimeStatus !== "connected" && (
              <p className="text-muted-foreground mt-4 border border-dashed px-3 py-2 text-xs">
                Agent runtime not connected. Run <code>pnpm dev</code> in the
                repo root.
              </p>
            )}
          </div>
        ) : null}
        {showOptimisticInitialPrompt && optimisticInitialPrompt ? (
          <UserMessage text={optimisticInitialPrompt} />
        ) : null}
        {chat.items.map((item, i) =>
          item.kind === "user" ? (
            <UserMessage key={i} text={item.text} />
          ) : (
            <div key={i} className="mx-auto w-full max-w-3xl min-w-0">
              <Blocks
                blocks={withoutMarkerLines(item.event.content)}
                progress={chat.toolProgress}
                capabilities={activeCapabilities}
                active={chat.status === "running"}
              />
            </div>
          ),
        )}
        {chat.streaming ? (
          <div className="chat-markdown mx-auto w-full max-w-3xl min-w-0 overflow-hidden text-sm leading-6 [overflow-wrap:anywhere]">
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
          <p className="border-destructive/40 text-destructive mx-auto max-w-3xl border px-3 py-2 text-xs">
            {chat.error}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {!observeOnly ? (
        <div className="mx-auto w-full max-w-3xl space-y-2">
          {composerOpen && (chat.items.length > 0 || chat.streaming) ? (
            <RecurringWorkComposer
              mode={composer === "oneoff" ? "one-off" : "recurring"}
              date={composerDate}
              playbookId={composerPlaybookId}
              onCompose={composeSchedule}
              onSubmit={submit}
              onDismiss={() => setComposerOpen(false)}
            />
          ) : null}
          {!composerOpen &&
          suggestions.length > 0 &&
          chat.status !== "running" ? (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setDraft(suggestion)}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground border px-2.5 py-1.5 text-xs transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
          <div className="bg-card/80 border backdrop-blur-lg">
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
              className="placeholder:text-muted-foreground w-full resize-none bg-transparent px-3 pt-3 text-sm leading-6 outline-none"
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
                    // The first explicit choice becomes the workspace default,
                    // so no later chat ever opens unresolved again.
                    if (
                      cloudOrganizationId &&
                      !getWorkspaceProvider(cloudOrganizationId)
                    ) {
                      setWorkspaceProvider(cloudOrganizationId, next);
                    }
                  }}
                >
                  <SelectTrigger className="text-muted-foreground hover:text-foreground data-[state=open]:text-foreground h-6 w-auto gap-1.5 border-transparent px-1 text-xs">
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
                    <span className="text-muted-foreground/50 text-xs">/</span>
                    <Select
                      value={model || "__auto__"}
                      onValueChange={(value) => {
                        const next = value === "__auto__" ? "" : value;
                        setChosenModel(next);
                        savePreferences(driver, next);
                      }}
                    >
                      <SelectTrigger className="text-muted-foreground hover:text-foreground data-[state=open]:text-foreground h-6 w-auto max-w-48 gap-1.5 border-transparent px-1 text-xs">
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
      ) : null}
    </div>
  );
}
