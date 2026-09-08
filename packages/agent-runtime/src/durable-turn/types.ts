import { z } from "zod";

import type {
  AgentInferenceMessage,
  AgentInferenceProgress,
  AgentInferenceRequest,
  AgentInferenceResult,
  AgentInferenceTool,
  AgentInferenceToolCall,
} from "@chief/agent-computer";
import type { JsonValue } from "@chief/relay-contracts";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export const toolEffectSchema = z.enum([
  "read_only",
  "idempotent",
  "non_replayable",
]);

export type ToolEffect = z.infer<typeof toolEffectSchema>;

export interface DurableTool {
  definition: AgentInferenceTool;
  effect: ToolEffect;
}

export const durableToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.union([z.string(), z.record(jsonValueSchema)]),
});

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().nullable(),
  reasoning: z.string().optional(),
  toolCalls: durableToolCallSchema.array().optional(),
  toolCallId: z.string().optional(),
  name: z.string().optional(),
});

const taskSchema = z.object({
  id: z.number().int().positive(),
  text: z.string().min(1).max(500),
  status: z.enum(["pending", "in_progress", "waiting", "completed"]),
  evidence: z.string().min(1).optional(),
});

export const durablePlanSchema = z.object({
  revision: z.number().int().nonnegative(),
  tasks: taskSchema.array().max(100),
});

export type DurablePlan = z.infer<typeof durablePlanSchema>;

export const checkpointMemorySchema = z.object({
  objective: z.string().min(1).max(4_000),
  completed: z.string().array().max(100),
  active: z.string().array().max(100),
  criticalContext: z.string().array().max(100),
  verifiedEvidence: z
    .object({ claim: z.string(), source: z.string() })
    .array()
    .max(100),
  artifacts: z.string().array().max(100),
  failedApproaches: z.string().array().max(100),
  constraints: z.string().array().max(100),
  nextAction: z.string().min(1).max(2_000),
  openQuestions: z.string().array().max(100),
});

const checkpointSchema = z.object({
  generation: z.number().int().positive(),
  sourceMessageCount: z.number().int().positive(),
  memory: checkpointMemorySchema,
  evidence: z
    .object({
      callId: z.string(),
      name: z.string(),
      result: jsonValueSchema,
    })
    .array(),
  trigger: z.object({
    ratio: z.number(),
    modelId: z.string(),
    contextWindowTokens: z.number().int().positive(),
    estimatedInputTokens: z.number().int().nonnegative(),
  }),
});

const toolReceiptSchema = z.object({
  call: durableToolCallSchema,
  effect: toolEffectSchema,
  state: z.enum(["prepared", "started", "completed"]),
  result: jsonValueSchema.optional(),
});

const runnablePhaseSchema = z.object({
  kind: z.literal("runnable"),
  next: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("infer") }),
    z.object({ kind: z.literal("tool"), callId: z.string() }),
    z.object({ kind: z.literal("compact") }),
  ]),
});

const phaseSchema = z.discriminatedUnion("kind", [
  runnablePhaseSchema,
  z.object({
    kind: z.literal("needs_attention"),
    reason: z.enum(["ambiguous_effect", "user_input"]),
    message: z.string(),
  }),
  z.object({ kind: z.literal("completed"), result: z.string().min(1) }),
  z.object({ kind: z.literal("failed"), error: z.string().min(1) }),
]);

export const durableTurnSchema = z.object({
  version: z.literal(1),
  jobId: z.string().min(1),
  leaseToken: z.string().min(1),
  conversationId: z.string().min(1),
  threadRootId: z.string().optional(),
  instruction: z.string().min(1),
  systemPrompt: z.string().min(1),
  browserEnabled: z.boolean(),
  computerEnabled: z.boolean().default(true),
  completion: z
    .object({
      requiredToolNames: z.string().min(1).array().max(32),
      browserMustRemainOpen: z.boolean(),
      rejectedFinishes: z.number().int().nonnegative(),
    })
    .default({
      requiredToolNames: [],
      browserMustRemainOpen: false,
      rejectedFinishes: 0,
    }),
  maxInferenceSteps: z.number().int().positive().default(64),
  inferenceSteps: z.number().int().nonnegative().default(0),
  interruptionCount: z.number().int().nonnegative().default(0),
  finalization: z
    .object({ reason: z.string().min(1) })
    .nullable()
    .default(null),
  phase: phaseSchema,
  settled: z.boolean(),
  revision: z.number().int().nonnegative(),
  claim: z
    .object({
      generation: z.number().int().positive(),
      recoverAfter: z.number().int().nonnegative(),
    })
    .nullable(),
  messages: messageSchema.array(),
  plan: durablePlanSchema,
  tools: toolReceiptSchema.array(),
  checkpoint: checkpointSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DurableTurn = z.infer<typeof durableTurnSchema>;
export type DurableTurnPhase = DurableTurn["phase"];
export type DurableToolCall = AgentInferenceToolCall;
export type DurableMessage = AgentInferenceMessage;

export interface CreateDurableTurn {
  jobId: string;
  leaseToken: string;
  conversationId: string;
  threadRootId?: string;
  instruction: string;
  systemPrompt: string;
  browserEnabled: boolean;
  computerEnabled?: boolean;
  maxInferenceSteps?: number;
  completion?: {
    requiredToolNames: readonly string[];
    browserMustRemainOpen: boolean;
  };
  history?: readonly AgentInferenceMessage[];
}

export interface DurableToolExecutor {
  execute(call: AgentInferenceToolCall): Promise<JsonValue>;
}

export interface DurableTurnObserver {
  inferenceStarted?(
    turn: DurableTurn,
    request: AgentInferenceRequest,
  ): Promise<void> | void;
  inferenceCompleted?(
    turn: DurableTurn,
    result: AgentInferenceResult,
  ): Promise<void> | void;
  inferenceProgress?(
    turn: DurableTurn,
    progress: AgentInferenceProgress,
  ): Promise<void> | void;
  toolStarted?(
    turn: DurableTurn,
    call: AgentInferenceToolCall,
  ): Promise<void> | void;
  toolCompleted?(
    turn: DurableTurn,
    call: AgentInferenceToolCall,
    result: JsonValue,
  ): Promise<void> | void;
  toolFailed?(
    turn: DurableTurn,
    call: AgentInferenceToolCall,
    error: Error,
  ): Promise<void> | void;
}

export type AdvanceResult =
  | { kind: "idle" }
  | { kind: "sleeping"; wakeAt: number }
  | { kind: "advanced"; turn: DurableTurn }
  | { kind: "terminal"; turn: DurableTurn };
