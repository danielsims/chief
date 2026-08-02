export type ComposerFormat =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "link"
  | "bullet-list"
  | "ordered-list"
  | "quote";

export interface ComposerEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export function composerShortcutFormat(
  key: string,
): ComposerFormat | undefined {
  const shortcut = key.toLocaleLowerCase();
  return shortcut === "b"
    ? "bold"
    : shortcut === "i"
      ? "italic"
      : shortcut === "k"
        ? "link"
        : undefined;
}

const INLINE_MARKS: Partial<
  Record<
    ComposerFormat,
    { prefix: string; suffix: string; placeholder: string }
  >
> = {
  bold: { prefix: "**", suffix: "**", placeholder: "bold text" },
  italic: { prefix: "_", suffix: "_", placeholder: "italic text" },
  strike: { prefix: "~~", suffix: "~~", placeholder: "strikethrough" },
  code: { prefix: "`", suffix: "`", placeholder: "code" },
};

function boundedSelection(value: string, start: number, end: number) {
  const selectionStart = Math.max(0, Math.min(start, value.length));
  const selectionEnd = Math.max(selectionStart, Math.min(end, value.length));
  return { selectionStart, selectionEnd };
}

export function insertComposerText(
  value: string,
  start: number,
  end: number,
  inserted: string,
): ComposerEdit {
  const selection = boundedSelection(value, start, end);
  const cursor = selection.selectionStart + inserted.length;
  return {
    value: `${value.slice(0, selection.selectionStart)}${inserted}${value.slice(selection.selectionEnd)}`,
    selectionStart: cursor,
    selectionEnd: cursor,
  };
}

export function openComposerMention(
  value: string,
  start: number,
  end: number,
): ComposerEdit | undefined {
  const selection = boundedSelection(value, start, end);
  const beforeCursor = value.slice(0, selection.selectionEnd);
  if (/(?:^|\s)@[^\s@]*$/u.test(beforeCursor)) return undefined;
  const previousCharacter = beforeCursor.slice(-1);
  const prefix =
    selection.selectionEnd > 0 &&
    previousCharacter &&
    !/\s/u.test(previousCharacter)
      ? " @"
      : "@";
  return insertComposerText(
    value,
    selection.selectionStart,
    selection.selectionEnd,
    prefix,
  );
}

function wrapSelection(
  value: string,
  start: number,
  end: number,
  mark: { prefix: string; suffix: string; placeholder: string },
): ComposerEdit {
  const selection = boundedSelection(value, start, end);
  const selected = value.slice(
    selection.selectionStart,
    selection.selectionEnd,
  );
  const content = selected || mark.placeholder;
  const replacement = `${mark.prefix}${content}${mark.suffix}`;
  const nextValue = `${value.slice(0, selection.selectionStart)}${replacement}${value.slice(selection.selectionEnd)}`;
  const contentStart = selection.selectionStart + mark.prefix.length;
  return {
    value: nextValue,
    selectionStart: contentStart,
    selectionEnd: contentStart + content.length,
  };
}

function prefixSelectedLines(
  value: string,
  start: number,
  end: number,
  prefixForLine: (index: number) => string,
): ComposerEdit {
  const selection = boundedSelection(value, start, end);
  const lineStart = value.lastIndexOf("\n", selection.selectionStart - 1) + 1;
  const nextLineBreak = value.indexOf("\n", selection.selectionEnd);
  const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
  const selectedLines = value.slice(lineStart, lineEnd).split("\n");
  const replacement = selectedLines
    .map((line, index) => `${prefixForLine(index)}${line}`)
    .join("\n");
  return {
    value: `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + replacement.length,
  };
}

export function formatComposerText(
  value: string,
  start: number,
  end: number,
  format: ComposerFormat,
): ComposerEdit {
  const mark = INLINE_MARKS[format];
  if (mark) return wrapSelection(value, start, end, mark);

  if (format === "link") {
    const selection = boundedSelection(value, start, end);
    const selected = value.slice(
      selection.selectionStart,
      selection.selectionEnd,
    );
    const label = selected || "link text";
    const replacement = `[${label}](https://)`;
    const nextValue = `${value.slice(0, selection.selectionStart)}${replacement}${value.slice(selection.selectionEnd)}`;
    const labelStart = selection.selectionStart + 1;
    const urlStart = labelStart + label.length + 2;
    return {
      value: nextValue,
      selectionStart: selected ? urlStart : labelStart,
      selectionEnd: selected ? urlStart + 8 : labelStart + label.length,
    };
  }

  const prefixForLine =
    format === "bullet-list"
      ? () => "- "
      : format === "ordered-list"
        ? (index: number) => `${index + 1}. `
        : () => "> ";
  return prefixSelectedLines(value, start, end, prefixForLine);
}
