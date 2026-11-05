import { ArrowUpRight, Columns3, FileText, Mail } from "lucide-react";
import { useNavigate } from "react-router";

import type { GenerativeDocumentBlock } from "@chief/agent-runtime/types";
import { channelArtifactPath } from "@chief/relay-contracts";
import { cn } from "@chief/ui/lib/utils";

import type { GenerativePartRenderer } from "../types";
import { useAuth } from "../../../lib/auth/auth-context";
import { useWorkspaceFiles } from "../../../lib/runtime";
import { insetBandClass, insetCardClass } from "../../inset-card";
import { pageBoard } from "../../pages/page-board";

function DocumentPart({ part }: { part: GenerativeDocumentBlock }) {
  const navigate = useNavigate();
  const { cloudOrganizationId } = useAuth();
  const { files } = useWorkspaceFiles(cloudOrganizationId);
  const file = files.find((file) => file.id === part.data.fileId);
  const board = pageBoard(file?.previewContent);
  const email = part.data.kind === "email";
  const Icon = board ? Columns3 : email ? Mail : FileText;
  return (
    <button
      type="button"
      aria-label={`Open ${board ? "board" : "file"}: ${part.data.title}`}
      onClick={() =>
        navigate(
          part.data.conversationId
            ? board
              ? `/conversations?${new URLSearchParams({ channel: part.data.conversationId, view: "artifacts", database: board.database })}`
              : channelArtifactPath(part.data.conversationId, part.data.fileId)
            : board
              ? `/artifacts/databases/${encodeURIComponent(board.database)}`
              : `/artifacts/${encodeURIComponent(part.data.fileId)}`,
        )
      }
      className={cn(
        insetBandClass,
        "block w-full max-w-md text-left transition-shadow hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--foreground)_14%,transparent)]",
      )}
    >
      <span className="text-muted-foreground flex h-7 items-center gap-2 px-2.5 text-[12px]">
        <Icon size={12} aria-hidden />
        <span>{board ? "Board" : email ? "Email" : "File"}</span>
        <ArrowUpRight size={13} className="ml-auto shrink-0" aria-hidden />
      </span>
      <span className={cn(insetCardClass, "block")}>
        <span className="block truncate text-sm leading-5 font-medium">
          {part.data.title}
        </span>
        <span className="text-muted-foreground mt-1 block truncate text-xs leading-4">
          {board
            ? "Open board"
            : part.data.conversationId
              ? "Open artifact"
              : part.data.path}
        </span>
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
