import { FileText, Mail, MoveUpRight } from "lucide-react";
import { useNavigate } from "react-router";

import type { GenerativeDocumentBlock } from "@chief/agent-runtime/types";
import { channelArtifactPath } from "@chief/relay-contracts";
import { cn } from "@chief/ui/lib/utils";

import type { GenerativePartRenderer } from "../types";
import {
  INLINE_RESULT_CARD_CLASS,
  INLINE_RESULT_ICON_CLASS,
} from "../../chat/inline-result-card";

function DocumentPart({ part }: { part: GenerativeDocumentBlock }) {
  const navigate = useNavigate();
  const Icon = part.data.kind === "email" ? Mail : FileText;
  return (
    <button
      type="button"
      onClick={() =>
        navigate(
          part.data.conversationId
            ? channelArtifactPath(part.data.conversationId, part.data.fileId)
            : `/files/${encodeURIComponent(part.data.fileId)}`,
        )
      }
      className={cn(INLINE_RESULT_CARD_CLASS, "rounded-lg py-3 text-sm")}
    >
      <span className={INLINE_RESULT_ICON_CLASS}>
        <Icon aria-hidden className="text-muted-foreground" size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{part.data.title}</span>
        <span className="text-muted-foreground mt-0.5 block truncate text-sm">
          {part.data.conversationId ? "Open in Canvas" : part.data.path}
        </span>
      </span>
      <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
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
