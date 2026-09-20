import type { JsonObject } from "@chief/relay-contracts";

export function openCodeSse(
  chunks: readonly JsonObject[],
  extraEvents: string[] = [],
) {
  const body = [
    ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`),
    ...extraEvents,
    "data: [DONE]",
  ].join("\n\n");
  return new Response(`${body}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

export function traceContext() {
  return {
    workspaceId: "workspace-test",
    workspaceName: "Test",
    agentId: "engineer",
    conversationId: "engineering",
    jobId: "job-test",
    workflowId: "00000000-0000-4000-8000-000000000001",
    includeContent: false,
  };
}
