/* eslint-disable max-lines */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

import type {
  ChatExecutionSelection,
  DriverType,
} from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";

import type { SchedulingDraft } from "./recurring-work-composer";
import { useAgentConfig } from "../../lib/agent-config";
import { useAuth } from "../../lib/auth/auth-context";
import {
  findPendingInputRequest,
  withoutMarkerLines,
} from "../../lib/integration-setup";
import { PROVIDER_META } from "../../lib/providers";
import {
  messageBlocks,
  useChiefChat,
  useProviderModels,
  useRuntime,
  useWorkspaceData,
} from "../../lib/runtime";
import { InputRequestSection } from "../integrations/input-request-section";
import { ApprovalCard } from "./approval-card";
import { Blocks, ToolActivityGroup } from "./message-blocks";
import { QuestionCard } from "./question-card";
import { RecurringWorkComposer } from "./recurring-work-composer";
import {
  ordinaryToolMessageGroups,
  specialistTaskOwners,
} from "./specialist-task-display";
import { StreamingMarkdown } from "./streaming-markdown";

const CHAT_PROVIDERS: DriverType[] = ["claude", "codex", "opencode", "remote"];

const CHAT_SUGGESTIONS = [
  "What should we focus on this week?",
  "Review our current marketing plan",
  "Where are we losing momentum?",
];

function UserMessage({ text }: { text: string }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 justify-end">
      <div className="chat-markdown bg-accent max-w-[80%] overflow-hidden border px-3 py-2 text-sm leading-6 [overflow-wrap:anywhere]">
        <StreamingMarkdown>{text}</StreamingMarkdown>
      </div>
    </div>
  );
}

export function ChiefChat({
  chatId,
  isNew,
  composer,
  composerDate,
  composerPlaybookId,
  initialPrompt,
  initialDraft,
  initialDriver,
  initialModel,
  onInitialPromptSent,
  onOpenChild,
}: {
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
  onInitialPromptSent?: () => void;
  onOpenChild?: (childId: string) => void;
}) {
  const { status: runtimeStatus } = useRuntime();
  const { cloudOrganizationId } = useAuth();
  const workspaceData = useWorkspaceData(cloudOrganizationId);
  const childSessions = workspaceData.activity
    .filter(
      (session) =>
        session.parentId === chatId &&
        session.kind === "task" &&
        session.visibility === "private" &&
        !session.scheduleId,
    )
    .sort((a, b) => a.createdAt - b.createdAt);
  const agentConfig = useAgentConfig();
  const resolved = agentConfig.forAgent("cmo");
  const initialExecution = initialDriver
    ? { driver: initialDriver, model: initialModel }
    : resolved.driver
      ? { driver: resolved.driver, model: resolved.model }
      : undefined;
  const [selectedExecution, setSelectedExecution] =
    useState<ChatExecutionSelection | null>(null);
  const activeCapabilities = resolved.capabilities;
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
  } = useChiefChat(
    chatId,
    initialExecution,
    selectedExecution ?? undefined,
    agentConfig.access,
  );
  const activeExecution = selectedExecution ?? execution ?? initialExecution;
  const driver = activeExecution?.driver;
  const model = activeExecution?.model;
  const providerModels = useProviderModels(driver ?? null);
  const [answeredInputs, setAnsweredInputs] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const pendingInput = useMemo(
    () => findPendingInputRequest(messages, answeredInputs),
    [messages, answeredInputs],
  );
  const hasActiveTool = useMemo(
    () =>
      messages.some(
        (message) =>
          message.role === "assistant" &&
          messageBlocks(message).some(
            (block) =>
              block.type === "tool_use" &&
              !messageBlocks(message).some(
                (candidate) =>
                  candidate.type === "tool_result" &&
                  candidate.tool_use_id === block.id,
              ),
          ),
      ),
    [messages],
  );
  const send = (text: string) => void sendMessage({ text });
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
  }, [messages.length]);

  useEffect(() => {
    if (
      initialPrompt &&
      !sentInitial.current &&
      driver &&
      chatReady &&
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
  }, [initialPrompt, runtimeStatus, driver, chatReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (controls.status === "running" || !driver || !chatReady) return;
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
    model ??
    "Auto";
  const showOptimisticInitialPrompt = Boolean(
    optimisticInitialPrompt &&
    !messages.some(
      (message) =>
        message.role === "user" &&
        messageBlocks(message).some(
          (part) =>
            part.type === "text" && part.text === optimisticInitialPrompt,
        ),
    ),
  );
  const childSessionOwners = specialistTaskOwners(
    messages.flatMap((message) =>
      message.role === "assistant"
        ? [
            {
              id: message.id,
              blocks: withoutMarkerLines(messageBlocks(message)),
            },
          ]
        : [],
    ),
    childSessions,
  );
  const ordinaryToolGroups = ordinaryToolMessageGroups(
    messages.map((message) => ({
      id: message.id,
      role: message.role,
      blocks: withoutMarkerLines(messageBlocks(message)),
    })),
    childSessions,
  );

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto py-6 pr-2">
        {/* A new chat has nothing to replay, so its identity header renders
            immediately; existing chats wait for history so the empty state
            never flashes before the transcript. */}
        {composerOpen && messages.length === 0 ? (
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
        {!chatReady && !isNew && !composerOpen && messages.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center font-mono text-xs">
            Loading conversation…
          </div>
        ) : null}
        {(chatReady || isNew) &&
        !composerOpen &&
        messages.length === 0 &&
        !showOptimisticInitialPrompt ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="font-serif text-3xl">Chief</p>
            <p className="text-muted-foreground max-w-md text-sm">
              Your CMO. Ask anything, and Chief will bring in the right
              specialist.
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
        {messages.map((message) =>
          message.role === "user" ? (
            message.id === `${chatId}-kickoff` ? (
              <div
                key={message.id}
                className="mx-auto w-full max-w-3xl border-y py-4"
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="size-1.5 bg-blue-500" />
                  Initial business review
                </div>
                <p className="text-muted-foreground mt-1 pl-3.5 text-xs">
                  Chief is learning your business. Research and specialist work
                  will appear here as it happens.
                </p>
              </div>
            ) : (
              <UserMessage
                key={message.id}
                text={messageBlocks(message)
                  .flatMap((part) => (part.type === "text" ? [part.text] : []))
                  .join("\n")}
              />
            )
          ) : message.role === "assistant" ? (
            ordinaryToolGroups.get(message.id) ? (
              ordinaryToolGroups.get(message.id)?.ownerId === message.id ? (
                <div
                  key={message.id}
                  className="mx-auto w-full max-w-3xl min-w-0"
                >
                  <ToolActivityGroup
                    blocks={ordinaryToolGroups.get(message.id)?.blocks ?? []}
                    progress={controls.toolProgress}
                    active={controls.status === "running"}
                  />
                </div>
              ) : null
            ) : (
              <div
                key={message.id}
                className="mx-auto w-full max-w-3xl min-w-0"
              >
                <Blocks
                  blocks={withoutMarkerLines(messageBlocks(message))}
                  progress={controls.toolProgress}
                  capabilities={activeCapabilities}
                  active={controls.status === "running"}
                  tasks={childSessions}
                  taskOwners={childSessionOwners}
                  ownerId={message.id}
                  onOpenTask={onOpenChild}
                />
              </div>
            )
          ) : (
            <div key={message.id} />
          ),
        )}
        {controls.approvals.map((approval) => (
          <div key={approval.requestId} className="mx-auto max-w-3xl">
            <ApprovalCard approval={approval} onRespond={respondPermission} />
          </div>
        ))}
        {controls.questions.map((pending) => (
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
        {controls.status === "running" &&
          !hasActiveTool &&
          controls.approvals.length === 0 && (
            <div className="mx-auto w-full max-w-3xl">
              <p className="agent-working font-mono text-xs">working…</p>
            </div>
          )}
        {controls.error && (
          <p className="border-destructive/40 text-destructive mx-auto max-w-3xl border px-3 py-2 text-xs">
            {controls.error}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mx-auto w-full max-w-3xl space-y-2">
        {composerOpen && messages.length > 0 ? (
          <RecurringWorkComposer
            mode={composer === "oneoff" ? "one-off" : "recurring"}
            date={composerDate}
            playbookId={composerPlaybookId}
            onCompose={composeSchedule}
            onSubmit={submit}
            onDismiss={() => setComposerOpen(false)}
          />
        ) : null}
        {!composerOpen && controls.status !== "running" ? (
          <div className="flex flex-wrap gap-2">
            {CHAT_SUGGESTIONS.map((suggestion) => (
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
            placeholder="Message Chief…"
            rows={2}
            className="placeholder:text-muted-foreground w-full resize-none bg-transparent px-3 pt-3 text-sm leading-6 outline-none"
          />
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex items-center gap-3">
              <Select
                value={driver ?? undefined}
                disabled={controls.status === "running"}
                onValueChange={(value) => {
                  const next = value as DriverType;
                  setSelectedExecution({ driver: next });
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
                    value={model ?? "__auto__"}
                    disabled={controls.status === "running"}
                    onValueChange={(value) => {
                      setSelectedExecution({
                        driver,
                        model: value === "__auto__" ? undefined : value,
                      });
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
            {controls.status === "running" ? (
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
