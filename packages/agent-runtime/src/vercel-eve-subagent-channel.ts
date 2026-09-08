import type { EveProjectFile } from "./vercel-eve-files.js";

/** Channel metadata follows native Eve delegation; credentials never enter the model prompt. */
export function eveDeliveryInstructions(prefix = "../"): string {
  return `import { defineDynamic, defineInstructions } from "eve/instructions";
import { openChiefDelivery, setCurrentChiefDelivery } from "${prefix}lib/chief-session.ts";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      const delivery = openChiefDelivery(context.channel.metadata?.chiefDelivery);
      if (!delivery) return null;
      setCurrentChiefDelivery({ ...delivery, sessionId: context.session.id });
      return defineInstructions({ content: [
        "Your final answer is automatically posted in the assigned Chief conversation under your own identity. Produce the requested work, not a promise to do it. Do not use ask_question; use the workspace messaging tools when a user answer is needed.",
        \`Conversation id: \${delivery.conversationId}. Thread root id: \${delivery.threadRootId}.\`,
        "Use these ids with workspace tools. Read the thread for the lead's plan and relevant context. Keep replies concise, clear and friendly. Never use em dashes.",
      ].join("\\n") });
    },
  },
});
`;
}

export function eveSubagentChannelFiles(
  directory: string,
  agentId: string,
): EveProjectFile[] {
  return [
    {
      path: `agent/subagents/${directory}/instructions/chief_delivery.ts`,
      contents: eveDeliveryInstructions("../../../"),
    },
    {
      path: `agent/subagents/${directory}/hooks/chief.ts`,
      contents: `import { defineHook } from "eve/hooks";
import { chiefSession } from "../../../lib/chief-session.ts";
import { postReply, postActivity } from "../../../channels/chief.ts";

const delivery = (context: { session: { parent?: { rootSessionId: string } } }) => {
  const state = chiefSession.get().delivery;
  const sessionId = context.session.parent?.rootSessionId;
  return state?.agentId === ${JSON.stringify(agentId)} && sessionId ? { channel: { state }, sessionId } : null;
};

export default defineHook({
  events: {
    async "message.completed"(event, context) {
      const current = delivery(context);
      if (!current || event.data.finishReason === "tool-calls") return;
      await postReply(current.channel, current.sessionId, event.data.turnId, event.data.message);
    },
    async "turn.completed"(event, context) {
      const current = delivery(context);
      if (!current) return;
      await postReply(current.channel, current.sessionId, event.data.turnId, "", true);
    },
    async "turn.failed"(event, context) {
      const current = delivery(context);
      if (!current) return;
      await postReply(current.channel, current.sessionId, event.data.turnId, "", true, "failed");
      await postActivity(current.channel, current.sessionId, {
        id: \`error:\${event.data.turnId}\`, kind: "error", version: 1,
        payload: { title: "Run interrupted", message: event.data.message, providerSessionId: context.session.id },
      });
    },
    async "action.result"(event, context) {
      const current = delivery(context);
      if (!current) return;
      await postActivity(current.channel, current.sessionId, {
        id: event.data.result.callId.slice(0, 128), kind: "tool", version: 1,
        payload: { name: "toolName" in event.data.result ? event.data.result.toolName : event.data.result.kind,
          status: event.data.status === "completed" ? "completed" : "failed",
          providerSessionId: context.session.id },
      });
    },
  },
});
`,
    },
  ];
}
