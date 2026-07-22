import { StreamingMarkdown } from "./streaming-markdown";

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 justify-end">
      <div className="chat-markdown bg-accent max-w-[80%] overflow-hidden border px-3 py-2 text-sm leading-6 [overflow-wrap:anywhere]">
        <StreamingMarkdown>{text}</StreamingMarkdown>
      </div>
    </div>
  );
}
