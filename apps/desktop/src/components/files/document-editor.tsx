import type { Editor } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Extension } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Suggestion from "@tiptap/suggestion";
import { Markdown } from "tiptap-markdown";

interface SlashItem {
  title: string;
  description: string;
  run: (editor: Editor) => void;
}

const slashItems: SlashItem[] = [
  {
    title: "Text",
    description: "Plain paragraph",
    run: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    title: "Heading 1",
    description: "Page section",
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Subsection",
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    title: "Bullet list",
    description: "Unordered list",
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    description: "Ordered list",
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    title: "To-do",
    description: "Checklist",
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    title: "Quote",
    description: "Quoted text",
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    title: "Code",
    description: "Code block",
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: "Divider",
    description: "Horizontal rule",
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
];

interface SlashState {
  items: SlashItem[];
  command: (item: SlashItem) => void;
  rect: DOMRect | null;
}

class SlashCommandBridge {
  private active: SlashState | null = null;
  private selected = 0;

  constructor(
    private readonly show: (state: SlashState | null) => void,
    private readonly select: (index: number) => void,
  ) {}

  set = (next: SlashState | null) => {
    this.active = next;
    this.selected = 0;
    this.show(next);
    this.select(0);
  };

  keyDown = (event: KeyboardEvent) => {
    if (!this.active?.items.length) return false;
    if (event.key === "ArrowDown") {
      this.selected = (this.selected + 1) % this.active.items.length;
      this.select(this.selected);
      return true;
    }
    if (event.key === "ArrowUp") {
      this.selected =
        (this.selected - 1 + this.active.items.length) %
        this.active.items.length;
      this.select(this.selected);
      return true;
    }
    if (event.key === "Enter") {
      const item = this.active.items[this.selected];
      if (!item) return false;
      this.active.command(item);
      return true;
    }
    if (event.key === "Escape") {
      this.active = null;
      this.show(null);
      return true;
    }
    return false;
  };
}

function slashExtension(bridge: {
  set: (state: SlashState | null) => void;
  keyDown: (event: KeyboardEvent) => boolean;
}) {
  return Extension.create({
    name: "chiefSlashCommands",
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: "/",
          command: ({ editor, range, props }) => {
            editor.chain().focus().deleteRange(range).run();
            (props as SlashItem).run(editor);
          },
          items: ({ query }) =>
            slashItems.filter((item) =>
              item.title.toLowerCase().includes(query.toLowerCase()),
            ),
          render: () => ({
            onStart: (props) =>
              bridge.set({
                items: props.items,
                command: props.command,
                rect: props.clientRect?.() ?? null,
              }),
            onUpdate: (props) =>
              bridge.set({
                items: props.items,
                command: props.command,
                rect: props.clientRect?.() ?? null,
              }),
            onKeyDown: ({ event }) => bridge.keyDown(event),
            onExit: () => bridge.set(null),
          }),
        }),
      ];
    },
  });
}

function markdownFromEditor(editor: Editor) {
  const storage = editor.storage as {
    markdown?: { getMarkdown: () => string };
  };
  return storage.markdown?.getMarkdown() ?? "";
}

export function DocumentEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (markdown: string) => void;
}) {
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const applyingRef = useRef(false);
  const lastValueRef = useRef(value);
  const slashBridge = useMemo(
    () => new SlashCommandBridge(setSlash, setSelectedIndex),
    [],
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: "Write, or press / for commands...",
      }),
      Markdown,
      slashExtension(slashBridge),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "chief-document-editor",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      if (applyingRef.current) return;
      const markdown = markdownFromEditor(nextEditor);
      lastValueRef.current = markdown;
      onChange(markdown);
    },
  });

  useEffect(() => {
    if (!editor || value === lastValueRef.current) return;
    applyingRef.current = true;
    editor.commands.setContent(value, false);
    applyingRef.current = false;
    lastValueRef.current = value;
  }, [editor, value]);

  return (
    <div className="relative min-h-[520px]">
      <EditorContent editor={editor} />
      {slash?.rect && slash.items.length > 0 ? (
        <div
          className="bg-popover text-popover-foreground fixed z-50 w-56 overflow-hidden border p-1 shadow-xl"
          style={{ left: slash.rect.left, top: slash.rect.bottom + 6 }}
        >
          {slash.items.map((item, index) => (
            <button
              key={item.title}
              type="button"
              className={`block w-full px-3 py-2 text-left ${index === selectedIndex ? "bg-accent" : ""}`}
              onMouseDown={(event) => {
                event.preventDefault();
                slash.command(item);
              }}
            >
              <span className="block text-xs font-medium">{item.title}</span>
              <span className="text-muted-foreground mt-0.5 block text-[11px]">
                {item.description}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
