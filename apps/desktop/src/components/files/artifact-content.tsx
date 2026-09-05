import { useMemo } from "react";

import type { WorkspaceFileSnapshot } from "@chief/agent-runtime/types";

import { StreamingMarkdown } from "../chat/streaming-markdown";
import { MediaPreview } from "./media-preview";

/** Untrusted agent code receives no app origin, credentials, bridge or network access. */
export function artifactDocument(content: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:light dark}body{margin:0;padding:24px;font:14px/1.6 system-ui,sans-serif}*{box-sizing:border-box}button,input,select{font:inherit}</style></head><body>${content}</body></html>`;
}

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
        sandbox="allow-scripts"
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
