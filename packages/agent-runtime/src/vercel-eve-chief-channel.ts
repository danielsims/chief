export const eveChiefChannelReplyGuidance =
  "On this Eve deployment, ordinary assistant text is delivered to the user as a Chief conversation message in DMs and channels unless you already published with channels_messages_post this turn. Write the reply they should see. Do not use Eve's ask_question for Chief conversations; post a Chief message instead. Address people with @Name and their principal id from the delivery roster or channels_members_list; they are users, never @chief (user). If projects_list is empty, call projects.recommend so they can attach a repository from a card — do not ask them to paste a git URL. When the current conversation id and user message id are supplied, you MUST call channels_reactions_add with emoji 👀 on that exact user message before any other work tool. Do this exactly once per user message. Never react to your own message. Remove your 👀 with channels_reactions_remove immediately before the substantive final reply. Use channels_messages_post for explicit checkpoints, questions the user must answer, or posts to another channel.";

export const chiefChannelSource = `import { createHash, timingSafeEqual } from "node:crypto";
import { defineChannel, GET, POST } from "eve/channels";
import { z } from "zod";
import {
  publishedDeliveries,
  setCurrentChiefDelivery,
} from "../lib/chief-session.ts";

const deliverySchema = z.object({ payload: z.object({
  deliveryId: z.string(), sessionAddress: z.string(),
  agentId: z.string().optional(),
  conversationId: z.string().optional(),
  threadRootId: z.string().optional(),
  continuation: z.object({ capability: z.string() }),
  message: z.object({ id: z.string().optional(), body: z.string() }),
  people: z.array(z.object({
    id: z.string(), name: z.string(), role: z.string(),
  })).optional(),
}) });
type ChiefState = {
  deliveryId: string; capability: string; agentId: string;
  conversationId: string; messageId: string; threadRootId: string;
};
const reasoningBuckets = new Map<string, number>();
const latestText = new Map<string, string>();
const postedReplies = new Set<string>();
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(\`\${name} is required.\`);
  return value;
};
const tokenHash = (value: string) => createHash("sha256").update(value).digest();
const authorized = (request: Request) => timingSafeEqual(
  tokenHash(request.headers.get("authorization") ?? ""),
  tokenHash(\`Bearer \${required("CHIEF_CHANNEL_TOKEN")}\`),
);
const activityId = (value: string) => value.slice(0, 128);
const activityText = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return (text ?? "").slice(0, 100_000);
};
const replyText = (value: unknown) => {
  if (typeof value === "string") return value.trim().slice(0, 100_000);
  return "";
};
const replyKey = (deliveryId: string, turnId: string) => \`\${deliveryId}:\${turnId}\`;
const peopleRoster = (people?: { id: string; name: string; role: string }[]) => {
  if (!people) return "";
  if (!people.length) {
    return "No human members are listed yet. Do not invent a @chief (user) tag.";
  }
  return \`People in this workspace: \${people.map((person) => \`@\${person.name} (\${person.role}, id \${person.id})\`).join("; ")}. Address a person with @Name and include their id in mentions. They are users, not agents. Never write @chief (user).\`;
};
const bindDelivery = (
  channel: { state: ChiefState },
  sessionId: string,
) => {
  setCurrentChiefDelivery({
    deliveryId: channel.state.deliveryId,
    capability: channel.state.capability,
    sessionId,
    conversationId: channel.state.conversationId,
    messageId: channel.state.messageId,
    threadRootId: channel.state.threadRootId,
  });
};
const relayUrl = (path: "activity" | "messages", agentId: string) => new URL(
  \`/v1/workspaces/\${encodeURIComponent(required("CHIEF_WORKSPACE_ID"))}/agents/\${encodeURIComponent(agentId)}/channel/\${path}\`,
  required("CHIEF_RELAY_URL"),
);
const postToChief = async (path: "activity" | "messages", agentId: string, body: unknown) => {
  const response = await fetch(relayUrl(path, agentId), {
    method: "POST",
    headers: { "authorization": \`Bearer \${required("CHIEF_CHANNEL_TOKEN")}\`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(\`Chief returned HTTP \${response.status}.\`);
};
const postActivity = async (
  channel: { state: ChiefState },
  sessionId: string,
  component: Record<string, unknown>,
) => {
  bindDelivery(channel, sessionId);
  await postToChief("activity", channel.state.agentId, {
    deliveryId: channel.state.deliveryId,
    continuation: { capability: channel.state.capability },
    sessionId,
    component,
  }).catch((error: unknown) => {
    console.error("[chief-activity] publish failed", {
      error: error instanceof Error ? error.message : String(error),
      sessionId,
    });
  });
};
const postReply = async (
  channel: { state: ChiefState },
  sessionId: string,
  turnId: string,
  body: unknown,
) => {
  bindDelivery(channel, sessionId);
  const text = replyText(body);
  if (!text) return;
  if (publishedDeliveries.has(channel.state.deliveryId)) return;
  const key = replyKey(channel.state.deliveryId, turnId);
  if (postedReplies.has(key)) return;
  postedReplies.add(key);
  try {
    await postToChief("messages", channel.state.agentId, {
      deliveryId: key.slice(0, 256),
      continuation: { capability: channel.state.capability },
      sessionId,
      body: text,
    });
  } catch (error: unknown) {
    postedReplies.delete(key);
    console.error("[chief-message] publish failed", {
      error: error instanceof Error ? error.message : String(error),
      sessionId,
      turnId,
    });
  }
};
const rememberText = (turnId: string, body: unknown, finishReason?: string) => {
  const text = replyText(body);
  if (text && (finishReason !== "tool-calls" || !latestText.has(turnId))) {
    latestText.set(turnId, text);
  }
  return text;
};
const inputRequestText = (requests: unknown) => {
  if (!Array.isArray(requests)) return "";
  return requests.flatMap((request) => {
    if (!request || typeof request !== "object") return [];
    const record = request as Record<string, unknown>;
    const prompt = record.prompt ?? record.message ?? record.question;
    return typeof prompt === "string" ? [prompt.trim()] : [];
  }).filter(Boolean).join("\\n");
};
const actionName = (action: { kind: string; toolName?: string; subagentName?: string; remoteAgentName?: string }) =>
  action.toolName ?? action.subagentName ?? action.remoteAgentName ?? (action.kind === "load-skill" ? "Load skill" : action.kind);
const actionResult = (result: { kind: string; toolName?: string; subagentName?: string; name?: string; output: unknown; isError?: boolean }) => ({
  name: result.toolName ?? result.subagentName ?? result.name ?? result.kind,
  output: activityText(result.output),
});

export default defineChannel<ChiefState, { state: ChiefState }>({
  state: { deliveryId: "", capability: "", agentId: "", conversationId: "", messageId: "", threadRootId: "" },
  context(state) {
    return { state };
  },
  routes: [
    GET("/channels/chief/health", async (request) => {
      if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
      return Response.json({ status: "ready", agentId: required("CHIEF_AGENT_ID"), workspaceId: required("CHIEF_WORKSPACE_ID") });
    }),
    POST<ChiefState>("/channels/chief/messages", async (request, { from }) => {
      if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
      const input = deliverySchema.parse(await request.json());
      const agentId = input.payload.agentId ?? required("CHIEF_AGENT_ID");
      const conversationId = input.payload.conversationId ?? "";
      const messageId = input.payload.message.id ?? "";
      const threadRootId = input.payload.threadRootId ?? "";
      const state = {
        deliveryId: input.payload.deliveryId,
        capability: input.payload.continuation.capability,
        agentId,
        conversationId,
        messageId,
        threadRootId,
      };
      const session = await from(input.payload.sessionAddress).send(input.payload.message.body, {
        auth: null,
        context: [
          ${JSON.stringify(eveChiefChannelReplyGuidance)},
          peopleRoster(input.payload.people),
          conversationId ? \`Current conversation id: \${conversationId}.\` : "",
          messageId ? \`User message id: \${messageId}.\` : "",
          threadRootId ? \`Thread root id: \${threadRootId}.\` : "",
          conversationId && messageId
            ? \`Call channels_reactions_add with channelId \${conversationId}, messageId \${messageId}, and emoji 👀 before any other work tool.\`
            : "",
        ].filter(Boolean),
        state,
      });
      setCurrentChiefDelivery({ ...state, sessionId: session.id });
      return Response.json({ status: "accepted", sessionId: session.id });
    }),
  ],
  events: {
    async "reasoning.appended"(event, channel, context) {
      const key = \`\${event.turnId}:\${event.stepIndex}\`;
      const bucket = Math.floor(event.reasoningSoFar.length / 500);
      if (reasoningBuckets.get(key) === bucket) return;
      reasoningBuckets.set(key, bucket);
      await postActivity(channel, context.session.id, {
        id: activityId(\`reasoning:\${key}\`), kind: "thinking", version: 1,
        payload: { text: event.reasoningSoFar, status: "working", providerSessionId: context.session.id },
      });
    },
    async "reasoning.completed"(event, channel, context) {
      const key = \`\${event.turnId}:\${event.stepIndex}\`;
      reasoningBuckets.delete(key);
      await postActivity(channel, context.session.id, {
        id: activityId(\`reasoning:\${key}\`), kind: "thinking", version: 1,
        payload: { text: event.reasoning, status: "completed", providerSessionId: context.session.id },
      });
    },
    async "actions.requested"(event, channel, context) {
      for (const action of event.actions) {
        await postActivity(channel, context.session.id, {
          id: activityId(action.callId), kind: "tool", version: 1,
          payload: { name: actionName(action), status: "running", input: activityText(action.input), providerSessionId: context.session.id },
        });
      }
    },
    async "action.result"(event, channel, context) {
      const result = actionResult(event.result);
      await postActivity(channel, context.session.id, {
        id: activityId(event.result.callId), kind: "tool", version: 1,
        payload: {
          name: result.name,
          status: event.status === "completed" ? "completed" : "failed",
          ...(event.status === "completed" ? { output: result.output } : { error: event.error?.message ?? result.output }),
          providerSessionId: context.session.id,
        },
      });
    },
    async "turn.failed"(event, channel, context) {
      await postActivity(channel, context.session.id, {
        id: activityId(\`error:\${event.turnId}\`), kind: "error", version: 1,
        payload: { code: event.code, title: "Run interrupted", message: event.message, retryable: "true", providerSessionId: context.session.id },
      });
    },
    async "message.completed"(event, channel, context) {
      const text = rememberText(event.turnId, event.message, event.finishReason);
      if (event.finishReason === "tool-calls") return;
      await postReply(channel, context.session.id, event.turnId, text);
    },
    async "turn.completed"(event, channel, context) {
      await postReply(channel, context.session.id, event.turnId, latestText.get(event.turnId));
    },
    async "input.requested"(event, channel, context) {
      const text = inputRequestText(event.requests) || latestText.get(event.turnId);
      await postReply(channel, context.session.id, event.turnId, text);
    },
    async "session.waiting"(event, channel, context) {
      for (const [turnId, text] of latestText) {
        await postReply(channel, context.session.id, turnId, text);
      }
    },
  },
});
`;
