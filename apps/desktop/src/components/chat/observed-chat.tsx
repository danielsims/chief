import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";

import type { AgentCapabilityId } from "@chief/agent-runtime/types";

import { withoutMarkerLines } from "../../lib/integration-setup";
import { messageBlocks, useObservedChat } from "../../lib/runtime";
import { Blocks, ToolActivityGroup } from "./message-blocks";
import { ordinaryToolMessageGroups } from "./specialist-task-display";
import { StreamingMarkdown } from "./streaming-markdown";

export function ObservedChat({
  chatId,
  label = "Run transcript",
  capabilities,
}: {
  chatId: string;
  label?: ReactNode;
  capabilities?: readonly AgentCapabilityId[];
}) {
  const { messages, controls, chatReady } = useObservedChat(chatId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);
  const ordinaryToolGroups = ordinaryToolMessageGroups(
    messages.map((message) => ({
      id: message.id,
      role: message.role,
      blocks: withoutMarkerLines(messageBlocks(message)),
    })),
    [],
  );
  const hasActiveTool = useMemo(
    () =>
      messages.some((message) => {
        if (message.role !== "assistant") return false;
        const blocks = withoutMarkerLines(messageBlocks(message));
        return blocks.some(
          (block) =>
            block.type === "tool_use" &&
            !blocks.some(
              (candidate) =>
                candidate.type === "tool_result" &&
                candidate.tool_use_id === block.id,
            ),
        );
      }),
    [messages],
  );

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="text-muted-foreground shrink-0 border-b py-2 text-left text-xs">
        {label}
      </div>
      <div className="min-w-0 flex-1 space-y-6 overflow-x-hidden overflow-y-auto p-6">
        {!chatReady ? (
          <p className="text-muted-foreground animate-pulse text-center font-mono text-xs">
            Loading transcript…
          </p>
        ) : null}
        {messages.map((message) => {
          const blocks = withoutMarkerLines(messageBlocks(message));
          if (message.role === "user") {
            const text = blocks
              .flatMap((block) => (block.type === "text" ? [block.text] : []))
              .join("\n");
            if (!text.trim()) return null;
            return (
              <div
                key={message.id}
                className="mx-auto flex w-full max-w-3xl justify-end"
              >
                <div className="chat-markdown bg-accent max-w-[80%] overflow-hidden border px-3 py-2 text-sm leading-6 [overflow-wrap:anywhere]">
                  <StreamingMarkdown>{text}</StreamingMarkdown>
                </div>
              </div>
            );
          }
          if (message.role !== "assistant" || blocks.length === 0) return null;
          const toolGroup = ordinaryToolGroups.get(message.id);
          if (toolGroup) {
            if (toolGroup.ownerId !== message.id) return null;
            return (
              <div
                key={message.id}
                className="mx-auto w-full max-w-3xl min-w-0"
              >
                <ToolActivityGroup
                  blocks={toolGroup.blocks}
                  progress={controls.toolProgress}
                  active={controls.status === "running"}
                />
              </div>
            );
          }
          return (
            <div key={message.id} className="mx-auto w-full max-w-3xl min-w-0">
              <Blocks
                blocks={blocks}
                progress={controls.toolProgress}
                capabilities={capabilities}
                active={controls.status === "running"}
              />
            </div>
          );
        })}
        {controls.error ? (
          <p className="border-destructive/40 text-destructive mx-auto max-w-3xl border px-3 py-2 text-xs">
            {controls.error}
          </p>
        ) : null}
        {controls.status === "running" && !hasActiveTool ? (
          <p className="agent-working text-muted-foreground mx-auto w-full max-w-3xl font-mono text-xs">
            Working on the next step…
          </p>
        ) : null}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
