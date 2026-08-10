"use client";

import { useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Code, Italic, List, ListOrdered, Quote, Redo2, Undo2 } from "lucide-react";
import { docToMarkdown } from "@/lib/markdown-doc";
import { renderMarkdown } from "@/lib/markdown";

type MarkdownEditorProps = {
  name: string;
  id?: string;
  defaultValue?: string;
  maxLength?: number;
  placeholder?: string;
};

type ToolButton = {
  key: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  run: (editor: Editor) => void;
  active: (editor: Editor) => boolean;
};

const TOOLS: ToolButton[] = [
  { key: "bold", label: "굵게", hint: "**텍스트**", icon: <Bold size={15} />, run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive("bold") },
  { key: "italic", label: "기울임", hint: "*텍스트*", icon: <Italic size={15} />, run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive("italic") },
  { key: "code", label: "코드 블록", hint: "``` 입력 후 엔터", icon: <Code size={15} />, run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive("codeBlock") },
  { key: "bullet", label: "목록", hint: "- 입력 후 공백", icon: <List size={15} />, run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
  { key: "ordered", label: "번호 목록", hint: "1. 입력 후 공백", icon: <ListOrdered size={15} />, run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive("orderedList") },
  { key: "quote", label: "인용", hint: "> 입력 후 공백", icon: <Quote size={15} />, run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive("blockquote") },
];

// Live Markdown editor. Typing Markdown applies the formatting in place — "# " becomes a
// heading, "- " a list, "```" a code block — via the editor's input rules. The value is
// serialised back to Markdown on every change so the rest of the app keeps storing plain text.
export function MarkdownEditor({ name, id, defaultValue = "", maxLength = 5000, placeholder }: MarkdownEditorProps) {
  const [markdown, setMarkdown] = useState(defaultValue);

  const editor = useEditor({
    // The editor renders on the client only; SSR would mismatch the contenteditable DOM.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, protocols: ["http", "https"] },
      }),
    ],
    // An empty body must start as an empty doc — renderMarkdown("") emits a <br>, which would
    // become a stray hard break in the first paragraph.
    content: defaultValue.trim() ? renderMarkdown(defaultValue) : "",
    editorProps: {
      attributes: {
        class: "md-surface",
        ...(id ? { id } : {}),
        ...(placeholder ? { "data-placeholder": placeholder } : {}),
      },
    },
    onUpdate: ({ editor: instance }) => setMarkdown(docToMarkdown(instance.getJSON())),
  });

  const over = markdown.length > maxLength;

  return (
    <div className="md-editor">
      <div className="md-toolbar">
        {TOOLS.map((tool) => (
          <button
            type="button"
            key={tool.key}
            aria-label={tool.label}
            aria-pressed={editor ? tool.active(editor) : false}
            className={editor && tool.active(editor) ? "active" : ""}
            title={`${tool.label} · ${tool.hint}`}
            onClick={() => editor && tool.run(editor)}
          >{tool.icon}</button>
        ))}
        <span className="md-toolbar-gap" />
        <button type="button" aria-label="실행 취소" title="실행 취소" onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={15} /></button>
        <button type="button" aria-label="다시 실행" title="다시 실행" onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={15} /></button>
      </div>
      <EditorContent editor={editor} />
      {/* The form still submits Markdown, exactly as before. */}
      <input type="hidden" name={name} value={markdown} />
      {/* Only speak up when the limit is actually exceeded — the syntax cheatsheet lived here
          before, but the formatting now applies as you type so it just added noise. */}
      {over && <small className="format-hint over-limit">{markdown.length.toLocaleString()}자 · {maxLength.toLocaleString()}자를 넘었습니다</small>}
    </div>
  );
}
