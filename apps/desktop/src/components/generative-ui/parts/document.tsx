import { FileText, Mail, MoveUpRight } from "lucide-react";
import { useNavigate } from "react-router";

import type { GenerativeDocumentBlock } from "@chief/agent-runtime/types";

import type { GenerativePartRenderer } from "../types";

function DocumentPart({ part }: { part: GenerativeDocumentBlock }) {
  const navigate = useNavigate();
  const Icon = part.data.kind === "email" ? Mail : FileText;
  return (
    <button
      type="button"
      onClick={() => navigate(`/files/${encodeURIComponent(part.data.fileId)}`)}
      className="bg-card/50 hover:bg-card flex w-full items-center gap-3 border px-4 py-3 text-left transition-colors"
    >
      <span className="bg-background flex size-9 shrink-0 items-center justify-center border">
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {part.data.title}
        </span>
        <span className="text-muted-foreground mt-0.5 block truncate font-mono text-[10px]">
          {part.data.path}
        </span>
      </span>
      <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
        Edit
        <MoveUpRight size={12} />
      </span>
    </button>
  );
}

const renderer: GenerativePartRenderer = {
  partType: "data-document",
  render: (part) =>
    part.type === "data-document" ? <DocumentPart part={part} /> : undefined,
};

export default renderer;
