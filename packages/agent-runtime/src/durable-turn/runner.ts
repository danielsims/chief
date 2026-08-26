import type {
  AgentInference,
  AgentInferenceResult,
  AgentInferenceToolCall,
} from "@chief/agent-computer";
import type { JsonValue } from "@chief/relay-contracts";

import type { CellPersistence } from "../cells/sqlite-store.js";
import type {
  AdvanceResult,
  CreateDurableTurn,
  DurableTool,
  DurableToolExecutor,
  DurableTurn,
  DurableTurnObserver,
} from "./types.js";
import {
  compactTurn,
  inferenceMessages,
  shouldCompact,
  validateCompactionRatio,
} from "./context.js";
import {
  completionReminder,
  durableTodoTools,
  executeTodo,
  hasOpenTasks,
  isTodoTool,
} from "./plan.js";
import { durableToolCallSchema, durableTurnSchema } from "./types.js";

const STATE_KEY = "durable-turn";
const MAX_OUTPUT_TOKENS = 2_000;
const CLAIM_TTL_MS = 60_000;

export class DurableTurnRunner {
  private readonly compactionRatio: number;

  constructor(
    private readonly persistence: CellPersistence,
    private readonly cellId: string,
    options: { compactionRatio?: number } = {},
  ) {
    this.compactionRatio = validateCompactionRatio(
      options.compactionRatio ?? 0.75,
    );
  }

  async create(input: CreateDurableTurn) {
    const existing = await this.load();
    if (existing && !existing.settled) return existing;
    const now = new Date().toISOString();
    const turn = durableTurnSchema.parse({
      version: 1,
      jobId: input.jobId,
      leaseToken: input.leaseToken,
      conversationId: input.conversationId,
      ...(input.threadRootId
        ? { threadRootId: input.threadRootId }
        : undefined),
      instruction: input.instruction,
      systemPrompt: input.systemPrompt,
      browserEnabled: input.browserEnabled,
      phase: { kind: "runnable", next: { kind: "infer" } },
      settled: false,
      revision: 0,
      claim: null,
      messages: [
        ...(input.history ?? []),
        { role: "user", content: input.instruction },
      ],
      plan: { revision: 0, tasks: [] },
      tools: [],
      createdAt: now,
      updatedAt: now,
    });
    await this.save(turn);
    return turn;
  }

  async active() {
    const turn = await this.load();
    return turn && !turn.settled ? turn : undefined;
  }

  async updateLeaseToken(leaseToken: string) {
    const turn = await this.requireActive();
    await this.save(this.updated(turn, { leaseToken }));
  }

  async deferUntil(wakeAt: number) {
    const turn = await this.requireActive();
    const generation = turn.claim?.generation ?? turn.revision + 1;
    await this.save(
      this.updated(turn, {
        claim: { generation, recoverAfter: wakeAt },
      }),
    );
  }

  async markSettled() {
    const turn = await this.requireActive();
    await this.save(this.updated(turn, { settled: true, claim: null }));
  }

  async nextWakeAt(now = Date.now()) {
    const turn = await this.active();
    if (!turn) return undefined;
    if (turn.phase.kind !== "runnable") return now + 50;
    return turn.claim ? Math.max(now + 50, turn.claim.recoverAfter) : now + 50;
  }

  async advance(input: {
    inference: AgentInference;
    tools: readonly DurableTool[];
    executor: DurableToolExecutor;
    observer?: DurableTurnObserver;
    scheduleRecovery: (wakeAt: number) => Promise<void>;
    now?: number;
  }): Promise<AdvanceResult> {
    const current = await this.active();
    if (!current) return { kind: "idle" };
    if (current.phase.kind !== "runnable") {
      return { kind: "terminal", turn: current };
    }
    const now = input.now ?? Date.now();
    if (current.claim && current.claim.recoverAfter > now) {
      return { kind: "sleeping", wakeAt: current.claim.recoverAfter };
    }
    const recovered = await this.recoverInterruptedTool(current);
    if (recovered.phase.kind !== "runnable") {
      return { kind: "terminal", turn: recovered };
    }
    const recoverAfter = now + CLAIM_TTL_MS;
    const claimed = this.updated(recovered, {
      claim: {
        generation: (recovered.claim?.generation ?? 0) + 1,
        recoverAfter,
      },
    });
    await this.save(claimed);
    await input.scheduleRecovery(recoverAfter);
    if (claimed.phase.kind !== "runnable") {
      return { kind: "terminal", turn: claimed };
    }

    if (claimed.phase.next.kind === "infer") {
      return await this.infer(
        claimed,
        input.inference,
        input.tools,
        input.observer,
      );
    }
    if (claimed.phase.next.kind === "compact") {
      return await this.compact(claimed, input.inference);
    }
    return await this.executeTool(
      claimed,
      input.tools,
      input.executor,
      input.observer,
    );
  }

  private async infer(
    turn: DurableTurn,
    inference: AgentInference,
    tools: readonly DurableTool[],
    observer?: DurableTurnObserver,
  ): Promise<AdvanceResult> {
    const definitions = [
      ...tools.map((tool) => tool.definition),
      ...durableTodoTools,
    ];
    if (
      shouldCompact({
        inference,
        turn,
        tools: definitions,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        policy: { compactionRatio: this.compactionRatio },
      })
    ) {
      const next = this.updated(turn, {
        phase: { kind: "runnable", next: { kind: "compact" } },
        claim: null,
      });
      await this.save(next);
      return { kind: "advanced", turn: next };
    }
    const request = {
      messages: inferenceMessages(turn),
      tools: definitions,
      maxTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.3,
    };
    await notify(() => observer?.inferenceStarted?.(turn, request));
    const response = await inference.complete(request);
    await notify(() => observer?.inferenceCompleted?.(turn, response));
    const next = this.commitInference(turn, response, tools);
    await this.save(next);
    return next.phase.kind === "runnable"
      ? { kind: "advanced", turn: next }
      : { kind: "terminal", turn: next };
  }

  private commitInference(
    turn: DurableTurn,
    response: AgentInferenceResult,
    tools: readonly DurableTool[],
  ) {
    const toolCalls = response.toolCalls.map((call) =>
      durableToolCallSchema.parse(call),
    );
    const messages = [
      ...turn.messages,
      {
        role: "assistant" as const,
        content: response.content,
        ...(toolCalls.length > 0 ? { toolCalls } : undefined),
      },
    ];
    if (toolCalls.length === 0) {
      const result = response.content?.trim();
      if (!result) throw new Error("The agent returned an empty response.");
      if (hasOpenTasks(turn.plan)) {
        return this.updated(turn, {
          messages: [
            ...messages,
            { role: "system", content: completionReminder(turn.plan) },
          ],
          claim: null,
        });
      }
      return this.updated(turn, {
        messages,
        phase: { kind: "completed", result },
        claim: null,
      });
    }
    const receipts = toolCalls.map((call) => ({
      call,
      effect: effectFor(call, tools),
      state: "prepared" as const,
    }));
    return this.updated(turn, {
      messages,
      tools: [...turn.tools, ...receipts],
      phase: {
        kind: "runnable",
        next: { kind: "tool", callId: toolCalls[0]?.id ?? "" },
      },
      claim: null,
    });
  }

  private async executeTool(
    turn: DurableTurn,
    tools: readonly DurableTool[],
    executor: DurableToolExecutor,
    observer?: DurableTurnObserver,
  ): Promise<AdvanceResult> {
    if (turn.phase.kind !== "runnable" || turn.phase.next.kind !== "tool") {
      throw new Error("The durable turn is not waiting for a tool.");
    }
    const callId = turn.phase.next.callId;
    const receipt = turn.tools.find(
      (candidate) => candidate.call.id === callId,
    );
    if (!receipt) throw new Error("The durable tool receipt is missing.");
    const started = this.updated(turn, {
      tools: turn.tools.map((candidate) =>
        candidate.call.id === receipt.call.id
          ? { ...candidate, state: "started" as const }
          : candidate,
      ),
    });
    await this.save(started);
    await notify(() => observer?.toolStarted?.(started, receipt.call));
    let result: JsonValue;
    try {
      if (isTodoTool(receipt.call.name)) {
        const todo = executeTodo(
          started,
          receipt.call.name,
          receipt.call.arguments,
        );
        result = todo.result;
        started.plan = todo.plan;
      } else {
        result = await executor.execute(receipt.call);
      }
      await notify(() =>
        observer?.toolCompleted?.(started, receipt.call, result),
      );
    } catch (error) {
      const failure =
        error instanceof Error ? error : new Error("Tool execution failed.");
      await notify(() =>
        observer?.toolFailed?.(started, receipt.call, failure),
      );
      if (receipt.effect === "non_replayable") {
        const paused = this.updated(started, {
          phase: {
            kind: "needs_attention",
            reason: "ambiguous_effect",
            message: `Chief cannot verify whether ${receipt.call.name} completed before it failed.`,
          },
          claim: null,
        });
        await this.save(paused);
        return { kind: "terminal", turn: paused };
      }
      result = {
        ok: false,
        error: failure.message,
      } satisfies JsonValue;
    }
    const committed = this.commitTool(started, receipt.call, result);
    await this.save(committed);
    return { kind: "advanced", turn: committed };
  }

  private commitTool(
    turn: DurableTurn,
    call: AgentInferenceToolCall,
    result: JsonValue,
  ) {
    const tools = turn.tools.map((candidate) =>
      candidate.call.id === call.id
        ? { ...candidate, state: "completed" as const, result }
        : candidate,
    );
    const next = tools.find((candidate) => candidate.state === "prepared");
    return this.updated(turn, {
      tools,
      messages: [
        ...turn.messages,
        {
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify(result).slice(0, 20_000),
        },
      ],
      phase: {
        kind: "runnable",
        next: next ? { kind: "tool", callId: next.call.id } : { kind: "infer" },
      },
      claim: null,
    });
  }

  private async compact(turn: DurableTurn, inference: AgentInference) {
    const checkpoint = await compactTurn({
      inference,
      turn,
      policy: { compactionRatio: this.compactionRatio },
    });
    const compacted = this.updated(turn, {
      checkpoint,
      messages: turn.messages.slice(-10),
      phase: { kind: "runnable", next: { kind: "infer" } },
      claim: null,
    });
    await this.save(compacted);
    return { kind: "advanced", turn: compacted } as const;
  }

  private async recoverInterruptedTool(turn: DurableTurn) {
    if (turn.phase.kind !== "runnable" || turn.phase.next.kind !== "tool") {
      return turn;
    }
    const callId = turn.phase.next.callId;
    const receipt = turn.tools.find(
      (candidate) => candidate.call.id === callId,
    );
    if (receipt?.state !== "started" || receipt.effect !== "non_replayable") {
      return turn;
    }
    const paused = this.updated(turn, {
      phase: {
        kind: "needs_attention",
        reason: "ambiguous_effect",
        message: `Chief cannot verify whether ${receipt.call.name} completed before the previous execution ended.`,
      },
      claim: null,
    });
    await this.save(paused);
    return paused;
  }

  private async requireActive() {
    const turn = await this.active();
    if (!turn) throw new Error("No durable turn is active.");
    return turn;
  }

  private async load() {
    const value = await this.persistence.readState(this.cellId, STATE_KEY);
    return value === undefined ? undefined : durableTurnSchema.parse(value);
  }

  private async save(turn: DurableTurn) {
    await this.persistence.writeState(
      this.cellId,
      STATE_KEY,
      durableTurnSchema.parse(turn),
    );
  }

  private updated(turn: DurableTurn, patch: Partial<DurableTurn>): DurableTurn {
    return durableTurnSchema.parse({
      ...turn,
      ...patch,
      revision: turn.revision + 1,
      updatedAt: new Date().toISOString(),
    });
  }
}

async function notify(notification: () => Promise<void> | void | undefined) {
  try {
    await notification();
  } catch {
    // Observability is a projection of durable work, never a prerequisite.
  }
}

function effectFor(
  call: AgentInferenceToolCall,
  tools: readonly DurableTool[],
) {
  if (isTodoTool(call.name)) return "idempotent" as const;
  const tool = tools.find(
    (candidate) => candidate.definition.name === call.name,
  );
  if (!tool) throw new Error(`Unknown durable tool: ${call.name}`);
  return tool.effect;
}
