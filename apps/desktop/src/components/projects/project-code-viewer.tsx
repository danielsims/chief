import { File } from "@pierre/diffs/react";

import { useTheme } from "../../lib/theme";

export function ProjectCodeViewer({
  path,
  content,
}: {
  path: string;
  content: string;
}) {
  const { resolved } = useTheme();
  return (
    <div className="min-w-0 overflow-x-auto text-[13px]">
      <File
        file={{
          name: path,
          contents: content,
          cacheKey: `${path}:${content.length}`,
        }}
        disableWorkerPool
        options={{
          theme: { dark: "github-dark", light: "github-light" },
          themeType: resolved,
          disableFileHeader: true,
          disableLineNumbers: false,
          overflow: "scroll",
          stickyHeader: false,
        }}
      />
    </div>
  );
}
