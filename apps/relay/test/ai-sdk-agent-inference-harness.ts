import type { AgentInferenceConfig, JsonObject } from "@chief/relay-contracts";

/** An OpenCode Go model served over Chat Completions. */
export const openCodeChatModel: AgentInferenceConfig = {
  provider: "opencode",
  model: "opencode-go/glm-5.3",
  secretRef: "opencode",
};

const responsesUsage = {
  input_tokens: 10,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens: 5,
  output_tokens_details: { reasoning_tokens: 0 },
};

/** The URL a stubbed fetch was called with. */
export function requestUrl(input: string | URL | Request) {
  return input instanceof Request ? input.url : input.toString();
}

/** A finished Responses API reply with text, tool calls or both. */
export function responsesJson(output: {
  text?: string;
  toolCalls?: { id: string; name: string; arguments: JsonObject }[];
}) {
  return Response.json({
    id: "resp_test",
    object: "response",
    created_at: 0,
    model: "gpt-6-luna",
    status: "completed",
    incomplete_details: null,
    output: [
      ...(output.text
        ? [
            {
              type: "message",
              id: "msg_test",
              role: "assistant",
              status: "completed",
              content: [
                { type: "output_text", text: output.text, annotations: [] },
              ],
            },
          ]
        : []),
      ...(output.toolCalls ?? []).map((call) => ({
        type: "function_call",
        id: `fc_${call.id}`,
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
        status: "completed",
      })),
    ],
    usage: responsesUsage,
  });
}

/** A streamed Responses API reply with reasoning and then text. */
export function responsesSse(reasoning: string, text: string) {
  const events: (JsonObject & { type: string })[] = [
    {
      type: "response.created",
      response: { id: "resp_test", created_at: 0, model: "gpt-6-luna" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "reasoning", id: "rs_test", encrypted_content: null },
    },
    {
      type: "response.reasoning_summary_part.added",
      item_id: "rs_test",
      summary_index: 0,
    },
    {
      type: "response.reasoning_summary_text.delta",
      item_id: "rs_test",
      summary_index: 0,
      delta: reasoning,
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "reasoning",
        id: "rs_test",
        encrypted_content: null,
        summary: [{ type: "summary_text", text: reasoning }],
      },
    },
    {
      type: "response.output_item.added",
      output_index: 1,
      item: { type: "message", id: "msg_test" },
    },
    {
      type: "response.output_text.delta",
      item_id: "msg_test",
      delta: text,
      logprobs: [],
    },
    {
      type: "response.output_item.done",
      output_index: 1,
      item: { type: "message", id: "msg_test" },
    },
    {
      type: "response.completed",
      response: { incomplete_details: null, usage: responsesUsage },
    },
  ];
  const body = events
    .map(
      (event, index) =>
        `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number: index })}`,
    )
    .join("\n\n");
  return new Response(`${body}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

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
    jobKind: "conversation.message",
    includeContent: false,
  };
}
