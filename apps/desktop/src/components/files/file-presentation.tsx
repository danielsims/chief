import type { LucideProps } from "lucide-react";
import { File, FileText, Image, Mail, Music2, Video } from "lucide-react";

import type { WorkspaceFileRecord } from "@chief/agent-runtime/types";

export function fileCategory(
  file: Pick<WorkspaceFileRecord, "mimeType" | "kind">,
) {
  if (file.mimeType.startsWith("image/")) return "Images";
  if (file.mimeType.startsWith("video/") || file.mimeType.startsWith("audio/"))
    return "Media";
  if (
    file.mimeType.startsWith("text/") ||
    file.kind === "email" ||
    file.mimeType === "application/pdf"
  )
    return "Documents";
  return "Other";
}

export function FileTypeIcon({
  file,
  ...props
}: LucideProps & { file: Pick<WorkspaceFileRecord, "mimeType" | "kind"> }) {
  if (file.mimeType.startsWith("image/")) return <Image {...props} />;
  if (file.mimeType.startsWith("video/")) return <Video {...props} />;
  if (file.mimeType.startsWith("audio/")) return <Music2 {...props} />;
  if (file.kind === "email") return <Mail {...props} />;
  return fileCategory(file) === "Documents" ? (
    <FileText {...props} />
  ) : (
    <File {...props} />
  );
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileDownloadName(
  file: Pick<WorkspaceFileRecord, "name" | "path">,
) {
  const extension = file.path
    .split("/")
    .at(-1)
    ?.match(/\.[a-z0-9]{1,10}$/iu)?.[0];
  const name = file.name.replace(/[\\/\r\n]/gu, "_");
  return extension && !name.toLowerCase().endsWith(extension.toLowerCase())
    ? `${name}${extension}`
    : name;
}

export function downloadFileBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
