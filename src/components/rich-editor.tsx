'use client';

import { useEffect } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, List, ListOrdered, Heading2, Quote, Undo2, Redo2 } from 'lucide-react';
import { sameContent, type RichNode } from '@/lib/contracts';

export function RichEditor({ content, label, onChange, disabled = false }: { content: RichNode; label: string; onChange?: (content: RichNode) => void; disabled?: boolean }) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false })],
    content,
    immediatelyRender: false,
    editable: !disabled && !!onChange,
    editorProps: { attributes: { role: 'textbox', 'aria-label': label, 'aria-multiline': 'true', class: 'document-content' } },
    onUpdate: ({ editor }) => onChange?.(editor.getJSON() as RichNode),
  });
  useEffect(() => {
    if (editor && !sameContent(editor.getJSON() as RichNode, content)) editor.commands.setContent(content, { emitUpdate: false });
  }, [editor, content]);
  useEffect(() => { editor?.setEditable(!disabled && !!onChange); }, [editor, disabled, onChange]);
  const state = useEditorState({ editor, selector: ({ editor }) => ({ bold: editor?.isActive('bold'), italic: editor?.isActive('italic'), heading: editor?.isActive('heading'), list: editor?.isActive('bulletList'), ordered: editor?.isActive('orderedList'), quote: editor?.isActive('blockquote') }) });
  if (!onChange) return <div className="read-only-document"><EditorContent editor={editor} /></div>;
  const actions = [
    { label: 'Bold', Icon: Bold, active: state?.bold, run: () => editor?.chain().focus().toggleBold().run() },
    { label: 'Italic', Icon: Italic, active: state?.italic, run: () => editor?.chain().focus().toggleItalic().run() },
    { label: 'Heading', Icon: Heading2, active: state?.heading, run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Bullet list', Icon: List, active: state?.list, run: () => editor?.chain().focus().toggleBulletList().run() },
    { label: 'Numbered list', Icon: ListOrdered, active: state?.ordered, run: () => editor?.chain().focus().toggleOrderedList().run() },
    { label: 'Quote', Icon: Quote, active: state?.quote, run: () => editor?.chain().focus().toggleBlockquote().run() },
    { label: 'Undo', Icon: Undo2, run: () => editor?.chain().focus().undo().run() },
    { label: 'Redo', Icon: Redo2, run: () => editor?.chain().focus().redo().run() },
  ];
  return <div className="rich-editor">
    <div className="editor-toolbar" role="toolbar" aria-label={`${label} formatting`}>
      {actions.map(({ label: title, Icon, active, run }) => <button key={title} type="button" title={title} aria-label={title} aria-pressed={active} disabled={disabled || !editor} onClick={run} className={active ? 'tool active' : 'tool'}><Icon size={16} /></button>)}
      <span className="toolbar-type">RICH TEXT</span>
    </div>
    <EditorContent editor={editor} />
  </div>;
}
