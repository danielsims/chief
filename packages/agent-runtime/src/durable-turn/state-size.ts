import type { DurableTurn } from "./types.js";

const encoder = new TextEncoder();

export interface DurableTurnStateSize {
  totalBytes: number;
  structuralBytes: number;
  instructionBytes: number;
  systemPromptBytes: number;
  messagesBytes: number;
  messageContentBytes: number;
  messageToolCallsBytes: number;
  planBytes: number;
  toolsBytes: number;
  toolArgumentsBytes: number;
  toolResultsBytes: number;
  checkpointBytes: number;
  checkpointMemoryBytes: number;
  checkpointEvidenceBytes: number;
  metadataBytes: number;
  messageCount: number;
  toolReceiptCount: number;
  checkpointEvidenceCount: number;
  largestMessageBytes: number;
  largestMessageRole: DurableTurn["messages"][number]["role"] | "none";
  largestToolResultBytes: number;
  largestToolResultName: string;
}

export function serializedBytes(value: unknown) {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : encoder.encode(serialized).byteLength;
}

export function measureDurableTurnState(
  turn: DurableTurn,
): DurableTurnStateSize {
  const instructionBytes = serializedBytes(turn.instruction);
  const systemPromptBytes = serializedBytes(turn.systemPrompt);
  const messagesBytes = serializedBytes(turn.messages);
  const planBytes = serializedBytes(turn.plan);
  const toolsBytes = serializedBytes(turn.tools);
  const checkpointBytes = serializedBytes(turn.checkpoint);
  const measuredTopLevelBytes =
    instructionBytes +
    systemPromptBytes +
    messagesBytes +
    planBytes +
    toolsBytes +
    checkpointBytes;
  const totalBytes = serializedBytes(turn);
  const topLevelValueBytes = Object.values(turn).reduce<number>(
    (total, value) => total + serializedBytes(value),
    0,
  );

  let largestMessageBytes = 0;
  let largestMessageRole: DurableTurnStateSize["largestMessageRole"] = "none";
  let messageContentBytes = 0;
  let messageToolCallsBytes = 0;
  for (const message of turn.messages) {
    const bytes = serializedBytes(message);
    if (bytes > largestMessageBytes) {
      largestMessageBytes = bytes;
      largestMessageRole = message.role;
    }
    messageContentBytes += serializedBytes(message.content);
    messageToolCallsBytes += serializedBytes(message.toolCalls);
  }

  let largestToolResultBytes = 0;
  let largestToolResultName = "none";
  let toolArgumentsBytes = 0;
  let toolResultsBytes = 0;
  for (const receipt of turn.tools) {
    toolArgumentsBytes += serializedBytes(receipt.call.arguments);
    const resultBytes = serializedBytes(receipt.result);
    toolResultsBytes += resultBytes;
    if (resultBytes > largestToolResultBytes) {
      largestToolResultBytes = resultBytes;
      largestToolResultName = receipt.call.name;
    }
  }

  return {
    totalBytes,
    structuralBytes: totalBytes - topLevelValueBytes,
    instructionBytes,
    systemPromptBytes,
    messagesBytes,
    messageContentBytes,
    messageToolCallsBytes,
    planBytes,
    toolsBytes,
    toolArgumentsBytes,
    toolResultsBytes,
    checkpointBytes,
    checkpointMemoryBytes: serializedBytes(turn.checkpoint?.memory),
    checkpointEvidenceBytes: serializedBytes(turn.checkpoint?.evidence),
    metadataBytes: topLevelValueBytes - measuredTopLevelBytes,
    messageCount: turn.messages.length,
    toolReceiptCount: turn.tools.length,
    checkpointEvidenceCount: turn.checkpoint?.evidence.length ?? 0,
    largestMessageBytes,
    largestMessageRole,
    largestToolResultBytes,
    largestToolResultName,
  };
}
