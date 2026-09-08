import { useMemo } from "react";

import type { WorkspaceFileSnapshot } from "@chief/agent-runtime/types";

import { StreamingMarkdown } from "../chat/streaming-markdown";
import { artifactDocument } from "./artifact-document";
import { MediaPreview } from "./media-preview";

export { artifactDocument } from "./artifact-document";

export function ArtifactContent({ file }: { file: WorkspaceFileSnapshot }) {
  const document = useMemo(
    () => (file.mimeType === "text/html" ? artifactDocument(file.content) : ""),
    [file.mimeType, file.content],
  );
  if (file.asset) return <MediaPreview file={file} />;
  if (file.mimeType === "text/html")
    return (
      <iframe
        title={file.name}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={document}
        className="min-h-[65vh] w-full flex-1 border-0"
      />
    );
  if (file.mimeType === "text/csv") return <CsvTable content={file.content} />;
  if (file.mimeType === "application/json") {
    let content = file.content;
    try {
      content = JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      /* Keep invalid drafts readable. */
    }
    return (
      <pre className="overflow-auto p-6 font-mono text-sm leading-6 whitespace-pre-wrap">
        {content}
      </pre>
    );
  }
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <StreamingMarkdown>{file.content}</StreamingMarkdown>
    </div>
  );
}

// Quoted commas, escaped quotes and embedded newlines are common in exported data.
export function csvRows(content: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '"') {
      if (quoted && content[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n")) {
      row.push(cell.replace(/\r$/u, ""));
      cell = "";
      if (char === "\n") {
        rows.push(row);
        row = [];
      }
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/u, ""));
    rows.push(row);
  }
  return rows;
}
function CsvTable({ content }: { content: string }) {
  const rows = useMemo(() => csvRows(content), [content]);
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {rows[0]?.map((cell, index) => (
              <th
                key={index}
                className="bg-muted/40 border-b px-5 py-3 font-medium"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(1).map((row, index) => (
            <tr key={index} className="hover:bg-muted/20">
              {row.map((cell, column) => (
                <td
                  key={column}
                  className="border-border/50 border-b px-5 py-3 whitespace-pre-wrap"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
