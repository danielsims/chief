/** Plain text for OS banners and compact previews; keep the stored message intact. */
export function messagePreviewText(markdown: string) {
  return markdown
    .replace(/^\s*(`{3,}|~{3,})[^\n]*$/gmu, "")
    .replace(/^\s{0,3}\[[^\]]+\]:\s+\S+.*$/gmu, "")
    .replace(/!?\[([^\]]*)\]\((?:[^()\n]|\([^()\n]*\))*\)/gu, "$1")
    .replace(/!?\[([^\]]+)\]\[[^\]]*\]/gu, "$1")
    .replace(/<(https?:\/\/[^>]+)>/gu, "$1")
    .replace(/<\/?[a-z][^>]*>/giu, "")
    .replace(
      /^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/gmu,
      "",
    )
    .replace(/^\s*(?:[-*_]\s*){3,}$/gmu, "")
    .replace(/(`+)([^`]+)\1/gu, "$2")
    .replace(/(\*{1,3}|~~)(\S(?:.*?\S)?)\1/gu, "$2")
    .replace(/(?<!\w)(_{1,3})(\S(?:.*?\S)?)\1(?!\w)/gu, "$2")
    .replace(/\\([\\`*_{}[\]()#+.!>-])/gu, "$1")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gu, (entity) => {
      switch (entity) {
        case "&amp;":
          return "&";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        case "&quot;":
          return '"';
        case "&apos;":
          return "'";
        default:
          return " ";
      }
    })
    .replace(/\s+/gu, " ")
    .trim();
}
