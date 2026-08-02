import type { Editor } from "@tiptap/react";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Extension } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

import type { ComposerFormat } from "./composer-editing";
import {
  removeAgentMentionBeforeCaret,
  splitAgentMentions,
} from "./agent-mention-parser";

type QueryKind = "emoji" | "emoji-complete" | "mention";

interface SelectionRange {
  from: number;
  to: number;
}

export interface ComposerRichTextHandle {
  dismissQuery: (kind: QueryKind, replacement: string) => void;
  focus: () => void;
  format: (format: ComposerFormat) => void;
  insertQueryResult: (kind: QueryKind, content: string) => void;
  insertText: (content: string) => void;
  openMention: () => void;
  preserveSelection: () => void;
  setMarkdown: (markdown: string) => void;
}

export interface ComposerRichTextState {
  activeFormats: ComposerFormat[];
  textBeforeCursor: string;
}

function markdownFromEditor(editor: Editor) {
  const storage = editor.storage as {
    markdown?: { getMarkdown: () => string };
  };
  return storage.markdown?.getMarkdown() ?? "";
}

function textBeforeSelection(editor: Editor) {
  const { $from } = editor.state.selection;
  return $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc");
}

function activeFormats(editor: Editor): ComposerFormat[] {
  return [
    editor.isActive("bold") ? "bold" : undefined,
    editor.isActive("italic") ? "italic" : undefined,
    editor.isActive("strike") ? "strike" : undefined,
    editor.isActive("code") ? "code" : undefined,
    editor.isActive("link") ? "link" : undefined,
    editor.isActive("bulletList") ? "bullet-list" : undefined,
    editor.isActive("orderedList") ? "ordered-list" : undefined,
    editor.isActive("blockquote") ? "quote" : undefined,
  ].filter((format): format is ComposerFormat => format !== undefined);
}

function editorState(editor: Editor): ComposerRichTextState {
  return {
    activeFormats: activeFormats(editor),
    textBeforeCursor: textBeforeSelection(editor),
  };
}

function queryRange(editor: Editor, kind: QueryKind) {
  const { empty, from } = editor.state.selection;
  if (!empty) return undefined;
  const before = textBeforeSelection(editor);
  const pattern =
    kind === "mention"
      ? /(?:^|\s)@([^\s@]*)$/u
      : kind === "emoji-complete"
        ? /(?:^|\s):([a-z0-9_+-]+):$/iu
        : /(?:^|\s):([a-z0-9_+-]*)$/iu;
  const match = pattern.exec(before);
  if (!match) return undefined;
  return {
    from: from - match[0].length,
    to: from,
    leadingSpace: /^\s/u.test(match[0]) ? " " : "",
  };
}

const AgentMentionDecorations = Extension.create({
  name: "agentMentionDecorations",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("agentMentionDecorations"),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, position) => {
              if (!node.isText || !node.text) return;
              let offset = 0;
              for (const segment of splitAgentMentions(node.text)) {
                const length =
                  segment.type === "mention"
                    ? segment.label.length + 1
                    : segment.value.length;
                if (segment.type === "mention") {
                  decorations.push(
                    Decoration.inline(
                      position + offset,
                      position + offset + length,
                      {
                        class:
                          "rounded-[5px] bg-foreground/[0.075] px-1.5 py-px shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_13%,transparent),inset_0_1px_0_color-mix(in_srgb,var(--background)_32%,transparent)]",
                        "data-composer-agent-mention": segment.agentId,
                      },
                    ),
                  );
                }
                offset += length;
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
          handleKeyDown(view, event) {
            if (
              event.key !== "Backspace" ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey
            )
              return false;
            const { empty, $from } = view.state.selection;
            if (!empty) return false;
            const paragraphText = $from.parent.textContent;
            const edit = removeAgentMentionBeforeCaret(
              paragraphText,
              $from.parentOffset,
              $from.parentOffset,
            );
            if (!edit) return false;
            const removedLength = paragraphText.length - edit.value.length;
            const parentStart = $from.start();
            view.dispatch(
              view.state.tr
                .delete(
                  parentStart + edit.selectionStart,
                  parentStart + edit.selectionStart + removedLength,
                )
                .scrollIntoView(),
            );
            return true;
          },
        },
      }),
    ];
  },
});

function applyFormat(
  editor: Editor,
  selection: SelectionRange,
  format: ComposerFormat,
) {
  const chain = editor.chain().focus().setTextSelection(selection);
  if (format === "bold") chain.toggleBold().run();
  else if (format === "italic") chain.toggleItalic().run();
  else if (format === "strike") chain.toggleStrike().run();
  else if (format === "code") chain.toggleCode().run();
  else if (format === "bullet-list") chain.toggleBulletList().run();
  else if (format === "ordered-list") chain.toggleOrderedList().run();
  else if (format === "quote") chain.toggleBlockquote().run();
  else if (selection.from !== selection.to) {
    chain.setLink({ href: "https://" }).run();
  } else {
    const label = "link text";
    chain
      .insertContent(label)
      .setTextSelection({
        from: selection.from,
        to: selection.from + label.length,
      })
      .setLink({ href: "https://" })
      .run();
  }
}

export const ComposerRichText = forwardRef<
  ComposerRichTextHandle,
  {
    value: string;
    placeholder: string;
    onKeyDown: (event: KeyboardEvent) => boolean;
    onStateChange: (state: ComposerRichTextState) => void;
    onValueChange: (value: string) => void;
  }
>(function ComposerRichText(
  { value, placeholder, onKeyDown, onStateChange, onValueChange },
  ref,
) {
  const applyingRef = useRef(false);
  const lastValueRef = useRef(value);
  const selectionRef = useRef<SelectionRange>({ from: 1, to: 1 });
  const onKeyDownRef = useRef(onKeyDown);
  const onStateChangeRef = useRef(onStateChange);
  const onValueChangeRef = useRef(onValueChange);
  onKeyDownRef.current = onKeyDown;
  onStateChangeRef.current = onStateChange;
  onValueChangeRef.current = onValueChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, horizontalRule: false }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
      Markdown,
      AgentMentionDecorations,
    ],
    content: value,
    editorProps: {
      attributes: {
        class:
          "min-h-14 max-h-40 overflow-y-auto px-3 pt-3 pb-2 text-[13px] leading-6 text-foreground outline-none [overflow-wrap:anywhere] [&_p]:m-0 [&_p]:min-h-6 [&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)] [&_strong]:font-semibold [&_em]:italic [&_s]:line-through [&_code]:rounded-[4px] [&_code]:bg-foreground/[0.07] [&_code]:px-1 [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:border-foreground/20 [&_blockquote]:pl-3 [&_ul]:my-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-0 [&_ol]:list-decimal [&_ol]:pl-5",
        spellcheck: "true",
      },
      handleKeyDown: (_view, event) => onKeyDownRef.current(event),
    },
    onCreate: ({ editor: nextEditor }) => {
      onStateChangeRef.current(editorState(nextEditor));
    },
    onSelectionUpdate: ({ editor: nextEditor }) => {
      selectionRef.current = {
        from: nextEditor.state.selection.from,
        to: nextEditor.state.selection.to,
      };
    },
    onTransaction: ({ editor: nextEditor }) => {
      onStateChangeRef.current(editorState(nextEditor));
    },
    onUpdate: ({ editor: nextEditor }) => {
      if (applyingRef.current) return;
      const markdown = markdownFromEditor(nextEditor);
      lastValueRef.current = markdown;
      onValueChangeRef.current(markdown);
    },
  });

  useEffect(() => {
    if (!editor || value === lastValueRef.current) return;
    applyingRef.current = true;
    editor.commands.setContent(value, false);
    applyingRef.current = false;
    lastValueRef.current = value;
    onStateChangeRef.current(editorState(editor));
  }, [editor, value]);

  useImperativeHandle(
    ref,
    () => ({
      dismissQuery(kind, replacement) {
        if (!editor) return;
        const range = queryRange(editor, kind);
        if (!range) return;
        editor
          .chain()
          .focus()
          .deleteRange({ from: range.from, to: range.to })
          .insertContent(`${range.leadingSpace}${replacement}`)
          .run();
      },
      focus() {
        editor?.commands.focus();
      },
      format(format) {
        if (!editor) return;
        applyFormat(editor, selectionRef.current, format);
      },
      insertQueryResult(kind, content) {
        if (!editor) return;
        const range = queryRange(editor, kind);
        if (!range) return;
        editor
          .chain()
          .focus()
          .deleteRange({ from: range.from, to: range.to })
          .insertContent(`${range.leadingSpace}${content} `)
          .run();
      },
      insertText(content) {
        editor
          ?.chain()
          .focus()
          .setTextSelection(selectionRef.current)
          .insertContent(content)
          .run();
      },
      openMention() {
        if (!editor || queryRange(editor, "mention")) return;
        const { $from } = editor.state.selection;
        const previous = $from.nodeBefore?.textContent.slice(-1) ?? "";
        editor
          .chain()
          .focus()
          .setTextSelection(selectionRef.current)
          .insertContent(previous && !/\s/u.test(previous) ? " @" : "@")
          .run();
      },
      preserveSelection() {
        if (!editor) return;
        selectionRef.current = {
          from: editor.state.selection.from,
          to: editor.state.selection.to,
        };
      },
      setMarkdown(markdown) {
        if (!editor) return;
        editor.commands.setContent(markdown, true);
        editor.commands.focus("end");
      },
    }),
    [editor],
  );

  return <EditorContent editor={editor} />;
});
