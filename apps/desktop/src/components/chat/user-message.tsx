import { StreamingMarkdown } from "./streaming-markdown";

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="group/message mx-auto flex w-full max-w-3xl min-w-0 gap-3 py-2">
      <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center border text-[10px] font-semibold">
        YOU
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 flex items-baseline gap-2">
          <strong className="text-[13px] font-semibold">You</strong>
          <span className="text-muted-foreground text-[10px]">
            in this channel
          </span>
        </div>
        <div className="chat-markdown overflow-hidden text-sm leading-6 [overflow-wrap:anywhere]">
          <StreamingMarkdown>{text}</StreamingMarkdown>
        </div>
      </div>
    </div>
  );
}
