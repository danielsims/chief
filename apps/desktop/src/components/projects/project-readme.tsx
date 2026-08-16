import type { ProjectReadmeSnapshot } from "@chief/agent-runtime/types";

import { StreamingMarkdown } from "../chat/streaming-markdown";

export function ProjectReadme({ readme }: { readme: ProjectReadmeSnapshot }) {
  return (
    <section className="border-border/70 mt-6 overflow-hidden rounded-xl border">
      <div className="border-border/70 bg-muted/45 flex h-11 items-center border-b px-4 text-[13px] font-medium">
        {readme.path}
      </div>
      <div className="px-5 py-5 text-[14px] leading-6 [&_.streamdown-root]:max-w-none">
        <StreamingMarkdown
          resolveImageSrc={(src) => readme.imageSources?.[src] ?? src}
        >
          {readme.content}
        </StreamingMarkdown>
        {readme.truncated ? (
          <p className="text-muted-foreground mt-4 text-[13px]">
            README preview truncated.
          </p>
        ) : null}
      </div>
    </section>
  );
}
