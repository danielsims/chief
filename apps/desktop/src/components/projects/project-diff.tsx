import { PatchDiff } from "@pierre/diffs/react";

import { useTheme } from "../../lib/theme";

/** Splits a combined unified diff into one patch string per changed file. */
export function splitPatchByFile(patch: string) {
  return patch
    .split(/(?=^diff --git )/m)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Renders one vertically stacked diff card per changed file, sharing the
 * commit/compare renderer and line model.
 */
export function ProjectDiffView({ patch }: { patch: string }) {
  const { resolved } = useTheme();
  const files = splitPatchByFile(patch);
  return (
    <div className="space-y-6">
      {files.map((filePatch, index) => (
        <div key={index} className="min-w-0 overflow-x-auto text-[13px]">
          <PatchDiff
            patch={filePatch}
            disableWorkerPool
            options={{
              theme: { dark: "github-dark", light: "github-light" },
              themeType: resolved,
              diffStyle: "unified",
              hunkSeparators: "line-info",
              overflow: "scroll",
              stickyHeader: true,
            }}
          />
        </div>
      ))}
    </div>
  );
}
