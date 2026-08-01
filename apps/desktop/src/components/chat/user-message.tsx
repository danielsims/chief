import { StreamingMarkdown } from "./streaming-markdown";

export function UserMessage({
  text,
  author = { name: "You" },
}: {
  text: string;
  author?: { name: string; image?: string };
}) {
  const initials = author.name
    .split(/\s+/u)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toLocaleUpperCase();

  return (
    <div className="group/message mx-auto flex w-full max-w-3xl min-w-0 gap-3 py-2">
      <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%,transparent)]">
        {author.image ? (
          <img src={author.image} alt="" className="size-full object-cover" />
        ) : (
          initials || "Y"
        )}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 flex items-baseline gap-2">
          <strong className="text-[13px] font-semibold">{author.name}</strong>
          <span className="text-muted-foreground text-[10px]">You</span>
        </div>
        <div className="chat-markdown overflow-hidden text-sm leading-6 [overflow-wrap:anywhere]">
          <StreamingMarkdown>{text}</StreamingMarkdown>
        </div>
      </div>
    </div>
  );
}
