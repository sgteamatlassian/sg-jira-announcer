// The message editor: "Visual" (what you see is what the popup shows) and
// "Code" (the plain text format) over the same value, with one toolbar.
import React, { useEffect, useRef, useState } from 'react';
import { renderRichText, domToMarkup } from './richtext.mjs';

const ICONS = {
  bold: <path d="M7 5h6a3.5 3.5 0 0 1 2.3 6.1A3.8 3.8 0 0 1 13.5 19H7V5zm2.5 2.3v3.4H13a1.7 1.7 0 0 0 0-3.4H9.5zm0 5.7v3.7h4a1.85 1.85 0 0 0 0-3.7h-4z" />,
  italic: <path d="M10 5h8v2.2h-2.9l-3.2 9.6H15V19H7v-2.2h2.9l3.2-9.6H10V5z" />,
  link: <path d="M10.6 13.4a1 1 0 0 1 0 1.4 1 1 0 0 1-1.4 0 5 5 0 0 1 0-7.1l3-3a5 5 0 0 1 7.1 7.1l-1.3 1.3a7 7 0 0 0-.4-2.4l.3-.3a3 3 0 0 0-4.3-4.3l-3 3a3 3 0 0 0 0 4.3zm2.8-2.8a1 1 0 0 1 1.4 0 5 5 0 0 1 0 7.1l-3 3a5 5 0 0 1-7.1-7.1L6 12.3a7 7 0 0 0 .4 2.4l-.3.3a3 3 0 0 0 4.3 4.3l3-3a3 3 0 0 0 0-4.3 1 1 0 0 1 0-1.4z" />,
  list: <path d="M4.5 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM9 6h11v2H9V6zm-4.5 4.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM9 11h11v2H9v-2zm-4.5 4.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM9 16h11v2H9v-2z" />,
  clear: <path d="M6 5h12v3h-2V7h-3.2l-1 4.3-1.8-1.8L10.6 7H8.4L6.9 5.5 6 5zM3.3 4.7 4.7 3.3l16 16-1.4 1.4-6.7-6.7L11.8 17H14v2H7v-2h2.7l1.1-4.8L3.3 4.7z" />
};
function Icon({ name }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">{ICONS[name]}</svg>;
}

// Web address or email: "name@example.com" becomes a mailto: link, anything
// else without a scheme becomes https://.
const normalizeUrl = value => {
  const url = value.trim();
  if (!url) return '';
  if (/^(https?:\/\/|mailto:)/i.test(url)) return url;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(url)) return `mailto:${url}`;
  return `https://${url.replace(/^\/+/, '')}`;
};

export function BodyEditor({ value, onChange, maxLength }) {
  const [mode, setMode] = useState('visual');
  const [active, setActive] = useState({});
  const [linkUrl, setLinkUrl] = useState(null); // null = link row closed
  const visual = useRef(null);
  const code = useRef(null);
  const preview = useRef(null);
  const emitted = useRef(null); // the markup the visual editor last produced
  const savedRange = useRef(null);

  // Fill the visual editor when it appears or when the value changed elsewhere
  // (never while typing - that would move the caret).
  useEffect(() => {
    if (mode !== 'visual' || !visual.current || emitted.current === value) return;
    renderRichText(visual.current, value);
    emitted.current = value;
  }, [mode, value]);
  useEffect(() => { if (mode === 'code' && preview.current) renderRichText(preview.current, value); }, [mode, value]);

  useEffect(() => {
    if (mode !== 'visual') return undefined;
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* optional */ }
    const update = () => {
      const selection = document.getSelection();
      if (!visual.current || !selection.anchorNode || !visual.current.contains(selection.anchorNode)) return;
      let node = selection.anchorNode;
      let link = false;
      while (node && node !== visual.current) { if (node.nodeName === 'A') link = true; node = node.parentNode; }
      setActive({
        bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'),
        list: document.queryCommandState('insertUnorderedList'), link
      });
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [mode]);

  function emitVisual() {
    const markup = domToMarkup(visual.current);
    emitted.current = markup;
    onChange(markup);
  }

  function visualCommand(command, argument) {
    visual.current.focus();
    document.execCommand(command, false, argument);
    emitVisual();
  }

  // Code mode: wrap the selection, or prefix the selected lines.
  const wrap = (before, after, placeholder) => {
    const area = code.current;
    const { selectionStart: start, selectionEnd: end } = area;
    const selected = value.slice(start, end) || placeholder;
    onChange(value.slice(0, start) + before + selected + after + value.slice(end));
    requestAnimationFrame(() => { area.focus(); area.setSelectionRange(start + before.length, start + before.length + selected.length); });
  };
  function codeList() {
    const area = code.current;
    const start = value.lastIndexOf('\n', area.selectionStart - 1) + 1;
    let end = value.indexOf('\n', area.selectionEnd);
    if (end < 0) end = value.length;
    const lines = value.slice(start, end).split('\n');
    const all = lines.every(line => /^- /.test(line) || !line.trim());
    const changed = lines.map(line => (!line.trim() ? line : all ? line.replace(/^- /, '') : /^- /.test(line) ? line : `- ${line}`)).join('\n');
    onChange(value.slice(0, start) + changed + value.slice(end));
    requestAnimationFrame(() => { area.focus(); area.setSelectionRange(start, start + changed.length); });
  }
  function codeClear() {
    const area = code.current;
    const { selectionStart: start, selectionEnd: end } = area;
    if (start === end) return;
    const plain = value.slice(start, end).replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1');
    onChange(value.slice(0, start) + plain + value.slice(end));
    requestAnimationFrame(() => { area.focus(); area.setSelectionRange(start, start + plain.length); });
  }

  function openLink() {
    if (mode === 'visual') {
      const selection = document.getSelection();
      savedRange.current = selection.rangeCount && visual.current.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
      let node = selection.anchorNode;
      while (node && node !== visual.current && node.nodeName !== 'A') node = node.parentNode;
      setLinkUrl(node && node.nodeName === 'A' ? node.getAttribute('href') || '' : '');
    } else {
      setLinkUrl('');
    }
  }
  function applyLink() {
    const url = normalizeUrl(linkUrl);
    setLinkUrl(null);
    if (mode === 'code') { if (url) wrap('[', `](${url})`, 'link text'); return; }
    visual.current.focus();
    const selection = document.getSelection();
    if (savedRange.current) { selection.removeAllRanges(); selection.addRange(savedRange.current); }
    if (!url) { visualCommand('unlink'); return; }
    if (selection.isCollapsed) {
      let node = selection.anchorNode;
      while (node && node !== visual.current && node.nodeName !== 'A') node = node.parentNode;
      if (node && node.nodeName === 'A') { node.setAttribute('href', url); emitVisual(); return; }
      const link = document.createElement('a');
      link.href = url;
      link.textContent = url;
      selection.getRangeAt(0).insertNode(link);
      selection.collapse(link.parentNode, Array.prototype.indexOf.call(link.parentNode.childNodes, link) + 1);
      emitVisual();
      return;
    }
    visualCommand('createLink', url);
  }

  const run = {
    bold: () => (mode === 'visual' ? visualCommand('bold') : wrap('**', '**', 'bold text')),
    italic: () => (mode === 'visual' ? visualCommand('italic') : wrap('*', '*', 'italic text')),
    list: () => (mode === 'visual' ? visualCommand('insertUnorderedList') : codeList()),
    clear: () => {
      if (mode === 'code') { codeClear(); return; }
      visual.current.focus();
      document.execCommand('removeFormat');
      document.execCommand('unlink');
      emitVisual();
    }
  };
  const tool = (name, label, onClick = run[name]) => (
    <button type="button" className={`tool${mode === 'visual' && active[name] ? ' on' : ''}`} title={label} aria-label={label}
      aria-pressed={mode === 'visual' ? !!active[name] : undefined}
      onMouseDown={event => event.preventDefault()} onClick={onClick}><Icon name={name} /></button>
  );

  function onKeyDown(event) {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'b') { event.preventDefault(); run.bold(); }
    else if (key === 'i') { event.preventDefault(); run.italic(); }
    else if (key === 'k') { event.preventDefault(); openLink(); }
  }

  return (
    <div className="body-editor">
      <div className="toolbar">
        {tool('bold', 'Bold (Ctrl/⌘ B)')}
        {tool('italic', 'Italic (Ctrl/⌘ I)')}
        {tool('link', 'Add or edit link (Ctrl/⌘ K)', openLink)}
        {tool('list', 'Bullet list')}
        <span className="divider" />
        {tool('clear', 'Remove formatting')}
        <span className="spacer" />
        <div className="modes" role="tablist" aria-label="Editor mode">
          {[['visual', 'Visual'], ['code', 'Code']].map(([id, label]) => (
            <button type="button" key={id} role="tab" aria-selected={mode === id} className={mode === id ? 'on' : ''}
              onClick={() => { setLinkUrl(null); emitted.current = null; setMode(id); }}>{label}</button>
          ))}
        </div>
      </div>

      {linkUrl != null && (
        <div className="link-row">
          <input autoFocus value={linkUrl} placeholder="https://… or name@example.com" aria-label="Link address or email" onChange={event => setLinkUrl(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); applyLink(); }
              if (event.key === 'Escape') setLinkUrl(null);
            }} />
          <button type="button" className="primary" onClick={applyLink}>{linkUrl.trim() ? 'Apply link' : 'Remove link'}</button>
          <button type="button" className="subtle" onClick={() => setLinkUrl(null)}>Cancel</button>
        </div>
      )}

      {mode === 'visual' ? (
        <div key="visual" className="richtext visual" ref={visual} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="Message text"
          onInput={emitVisual} onKeyDown={onKeyDown}
          onPaste={event => {
            // Plain text only: formatting from Word or web pages never gets in.
            event.preventDefault();
            document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
          }} />
      ) : (
        <div key="code" className="columns code-columns">
          <textarea ref={code} rows={9} value={value} aria-label="Message text (code)" spellCheck={false}
            onChange={event => onChange(event.target.value)} onKeyDown={onKeyDown} />
          <div className="richtext body-preview" ref={preview} />
        </div>
      )}
      <div className="editor-foot muted">
        <span>{mode === 'code' ? 'Blank line = new paragraph · “- ” = bullet · **bold** · *italic* · [link text](https://… or mailto:…) · email addresses become links' : 'Enter = new paragraph · Shift+Enter = line break'}</span>
        <span className={value.length > maxLength ? 'over' : ''}>{value.length} / {maxLength}</span>
      </div>
    </div>
  );
}
