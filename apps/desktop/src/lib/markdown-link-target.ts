export type MarkdownLinkTarget =
  { kind: "path"; value: string } | { kind: "url"; value: string };

function decodedPath(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function markdownLinkTarget(href: string): MarkdownLinkTarget | null {
  if (href.startsWith("/") && !href.startsWith("//")) {
    const path = decodedPath(href);
    return path ? { kind: "path", value: path } : null;
  }

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol === "http:" || url.protocol === "https:") {
    return { kind: "url", value: url.toString() };
  }
  if (
    url.protocol === "file:" &&
    (!url.hostname || url.hostname === "localhost")
  ) {
    const path = decodedPath(url.pathname);
    return path ? { kind: "path", value: path } : null;
  }
  return null;
}

/** Streamdown sanitizes file URLs, so convert only local Markdown link targets. */
export function normalizeLocalFileLinks(markdown: string) {
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, index) =>
      index % 2
        ? part
        : part.replace(
            /\]\((file:\/\/[^)\s]+)\)/g,
            (match, href: string, offset: number, source: string) => {
              const openingBracket = source.lastIndexOf("[", offset);
              if (openingBracket > 0 && source[openingBracket - 1] === "!") {
                return match;
              }
              const target = markdownLinkTarget(href);
              return target?.kind === "path"
                ? `](${encodeURI(target.value).replace(/\(/g, "%28").replace(/\)/g, "%29")})`
                : match;
            },
          ),
    )
    .join("");
}
