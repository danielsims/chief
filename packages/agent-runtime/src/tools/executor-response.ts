import { isJsonObject } from "@chief/relay-contracts";

interface ExecutionResponse {
  status: string;
  isError?: boolean;
  text: string;
  structured?: unknown;
}

export function executorStructuredResult(response: ExecutionResponse): unknown {
  if (response.status !== "completed") {
    throw new Error(
      "The local connection unexpectedly paused a trusted Chief operation.",
    );
  }
  if (response.isError) throw new Error(response.text);
  if (
    response.structured &&
    isJsonObject(response.structured) &&
    Object.prototype.hasOwnProperty.call(response.structured, "result")
  ) {
    return (response.structured as { result: unknown }).result;
  }
  throw new Error(
    "The local connection completed without a structured result.",
  );
}
