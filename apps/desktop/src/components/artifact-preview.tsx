import type { ExecutorArtifactSummary } from "@chief/agent-runtime/artifact-types";

export function ArtifactPreview({
  artifact,
}: {
  artifact: ExecutorArtifactSummary;
}) {
  if (artifact.preview) {
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 min-h-[450px] w-[720px] origin-top-left scale-[0.48] [contain:layout_paint_style]"
        // Executor only returns markup that passed its inert-element and
        // attribute allowlist; the local daemon is the trust boundary here.
        dangerouslySetInnerHTML={{ __html: artifact.preview.markup }}
      />
    );
  }

  return (
    <div aria-hidden className="absolute inset-0 grid grid-cols-3 gap-2 p-5">
      <div className="border-border bg-background col-span-2 rounded-lg border p-3">
        <span className="bg-foreground/15 block h-1.5 w-14 rounded-full" />
        <span className="bg-foreground/8 mt-4 block h-12 rounded-md" />
        <span className="bg-foreground/10 mt-2 block h-1.5 w-3/4 rounded-full" />
      </div>
      <div className="space-y-2">
        <span className="border-border bg-background block h-[58px] rounded-lg border" />
        <span className="border-border bg-background block h-[58px] rounded-lg border" />
      </div>
    </div>
  );
}
