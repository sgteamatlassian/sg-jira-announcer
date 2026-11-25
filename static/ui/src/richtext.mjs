// A deliberately small text format for announcement bodies, rendered without
// innerHTML so nothing an administrator types can become markup or script:
//   blank line = new paragraph, "- " = bullet, **bold**, *italic*,
//   [text](https://…) and bare https://… links.

const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"]+)/g;

export function parseInline(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    if (match[1] != null) parts.push({ text: match[1], bold: true });
    else if (match[2] != null) parts.push({ text: match[2], italic: true });
    else if (match[3] != null) parts.push({ text: match[3], href: match[4] });
    else {
      // Punctuation right after a bare link belongs to the sentence.
      const href = match[5].replace(/[.,;:!?)]+$/, '');
      parts.push({ text: href, href });
      if (href.length < match[5].length) parts.push({ text: match[5].slice(href.length) });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

// -> [{ type: 'p', lines: [inline[]] } | { type: 'ul', items: [inline[]] }]
export function parseRichText(source) {
  const blocks = [];
  let block = null;
  for (const raw of String(source || '').split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line) { block = null; continue; }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      if (block?.type !== 'ul') { block = { type: 'ul', items: [] }; blocks.push(block); }
      block.items.push(parseInline(bullet[1]));
    } else {
      if (block?.type !== 'p') { block = { type: 'p', lines: [] }; blocks.push(block); }
      block.lines.push(parseInline(line));
    }
  }
  return blocks;
}

export function toPlainText(source) {
  return parseRichText(source).map(block => (block.type === 'ul'
    ? block.items.map(item => `• ${item.map(part => part.text).join('')}`).join('\n')
    : block.lines.map(line => line.map(part => part.text).join('')).join('\n'))).join('\n\n');
}

function appendInline(parent, parts, onLink) {
  for (const part of parts) {
    let node;
    if (part.href) {
      node = document.createElement('a');
      node.href = part.href;
      node.target = '_blank';
      node.rel = 'noopener noreferrer';
      if (onLink) node.addEventListener('click', event => { event.preventDefault(); onLink(part.href); });
    } else if (part.bold) node = document.createElement('strong');
    else if (part.italic) node = document.createElement('em');
    else node = document.createTextNode(part.text);
    if (node.nodeType === 1) node.textContent = part.text;
    parent.appendChild(node);
  }
}

// Replaces the content of `container` with the rendered text.
export function renderRichText(container, source, onLink) {
  container.replaceChildren();
  for (const block of parseRichText(source)) {
    if (block.type === 'ul') {
      const list = document.createElement('ul');
      for (const item of block.items) appendInline(list.appendChild(document.createElement('li')), item, onLink);
      container.appendChild(list);
    } else {
      const paragraph = document.createElement('p');
      block.lines.forEach((line, index) => {
        if (index) paragraph.appendChild(document.createElement('br'));
        appendInline(paragraph, line, onLink);
      });
      container.appendChild(paragraph);
    }
  }
}
