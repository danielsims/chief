"use node";

import { gateway, stepCountIs, streamText } from "ai";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { SYSTEM_INSTRUCTIONS } from "./generated";
import { chiefTools } from "./tools";

export const run = internalAction({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const state = await ctx.runQuery(internal.sessions.state, { publicId });
    if (state?.status !== "running") return;
    const configuredModel = process.env.CHIEF_DEPLOYMENT_MODEL;
    const model = configuredModel ?? "xai/grok-4.3";
    if (!process.env.AI_GATEWAY_API_KEY) {
      await ctx.runMutation(internal.sessions.finish, {
        publicId,
        status: "failed",
        error: "AI_GATEWAY_API_KEY is not configured.",
      });
      return;
    }

    const abort = new AbortController();
    try {
      const result = streamText({
        model: gateway(model),
        system: SYSTEM_INSTRUCTIONS,
        messages: state.messages,
        tools: chiefTools(model),
        stopWhen: stepCountIs(8),
        maxOutputTokens: 4_000,
        maxRetries: 1,
        abortSignal: abort.signal,
      });
      let text = "";
      let pending = "";
      const appendPending = async () => {
        if (!pending) return;
        await ctx.runMutation(internal.sessions.append, {
          publicId,
          event: { type: "stream", text: pending },
        });
        pending = "";
      };
      const assertRunning = async () => {
        const current = await ctx.runQuery(internal.sessions.state, {
          publicId,
        });
        if (current?.status === "cancelled") {
          abort.abort();
          throw new Error("Turn interrupted");
        }
      };
      for await (const part of result.stream) {
        if (part.type === "text-delta") {
          text += part.text;
          pending += part.text;
          if (pending.length < 256) continue;
          await assertRunning();
          await appendPending();
        } else if (part.type === "tool-call") {
          await appendPending();
          await assertRunning();
          await ctx.runMutation(internal.sessions.append, {
            publicId,
            event: {
              type: "message",
              id: `${publicId}-${part.toolCallId}-call`,
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: part.toolCallId,
                  name: part.toolName,
                  input: part.input,
                },
              ],
            },
          });
        } else if (part.type === "tool-result") {
          await ctx.runMutation(internal.sessions.append, {
            publicId,
            event: {
              type: "message",
              id: `${publicId}-${part.toolCallId}-result`,
              role: "assistant",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: part.toolCallId,
                  content: part.output,
                },
              ],
            },
          });
        } else if (part.type === "tool-error") {
          throw part.error instanceof Error
            ? part.error
            : new Error("A Convex agent tool failed.");
        } else if (part.type === "error") {
          throw part.error instanceof Error
            ? part.error
            : new Error("AI Gateway execution failed.");
        } else if (part.type === "abort") {
          throw new Error(part.reason ?? "AI Gateway execution was aborted.");
        }
      }
      await appendPending();
      if (!text.trim())
        throw new Error("AI Gateway returned an empty response.");
      await ctx.runMutation(internal.sessions.finish, {
        publicId,
        status: "completed",
        text,
      });
    } catch (error) {
      const current = await ctx.runQuery(internal.sessions.state, { publicId });
      if (current?.status === "cancelled") return;
      await ctx.runMutation(internal.sessions.finish, {
        publicId,
        status: "failed",
        error:
          error instanceof Error
            ? error.message.slice(0, 1_000)
            : "Agent execution failed.",
      });
    }
  },
});
