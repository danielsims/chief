import type { ProjectReadmeSnapshot } from "@chief/agent-runtime/types";

import { StreamingMarkdown } from "../chat/streaming-markdown";

function readmeLinkPlaceholder(path: string) {
  return `https://chief.local/readme-links/${encodeURIComponent(path)}`;
}

/**
 * Streamdown's URL hardening drops relative links (they have no base origin),
 * rendering them as "[blocked]". Rewrite repository-relative links to a
 * placeholder the app routes back into the repository browser.
 */
function normalizeReadmeLinks(content: string) {
  return content.replace(
    /(?<!!)\[([^\]]*)\]\(\s*([^)\s]+)\s*\)/g,
    (match, label: string, target: string) => {
      const trimmed = target.trim();
      if (
        /^(?:https?:|mailto:|data:|#|\/)/i.test(trimmed) ||
        /^chief\.local\//i.test(trimmed)
      ) {
        return match;
      }
      return `[${label}](${readmeLinkPlaceholder(trimmed)})`;
    },
  );
}

export function ProjectReadme({
  readme,
  onOpenPath,
}: {
  readme: ProjectReadmeSnapshot;
  onOpenPath?: (path: string) => void;
}) {
  return (
    <section className="border-border/70 mt-6 overflow-hidden rounded-xl border">
      <div className="border-border/70 bg-muted/45 flex h-11 items-center border-b px-4 text-[13px] font-medium">
        {readme.path}
      </div>
      <div className="px-5 py-5 text-[14px] leading-6 [&_.streamdown-root]:max-w-none">
        <StreamingMarkdown
          resolveImageSrc={(src) => readme.imageSources?.[src] ?? src}
          onRepoPath={onOpenPath}
        >
          {normalizeReadmeLinks(readme.content)}
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
