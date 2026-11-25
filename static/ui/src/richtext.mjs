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

// ---- Visual editor: DOM back to the text format ------------------------------
// Works on anything shaped like DOM nodes (nodeType, nodeName, childNodes,
// nodeValue, getAttribute, style), so it can be tested without a browser.

const BLOCKS = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);
const isBold = node => ['B', 'STRONG'].includes(node.nodeName) || /^(bold|[6-9]00)$/.test(node.style?.fontWeight || '');
const isItalic = node => ['I', 'EM'].includes(node.nodeName) || node.style?.fontStyle === 'italic';

// Flat runs of { text, mark } - the format has no nested emphasis, the
// outermost mark wins. A line break is the run { br: true }.
function collectRuns(node, mark, runs) {
  for (const child of node.childNodes || []) {
    if (child.nodeType === 3) {
      const text = (child.nodeValue || '').replace(/ /g, ' ').replace(/[\r\n]+/g, ' ');
      if (!text) continue;
      const last = runs[runs.length - 1];
      if (last && !last.br && last.mark === mark) last.text += text; else runs.push({ text, mark });
    } else if (child.nodeType === 1) {
      if (child.nodeName === 'BR') { runs.push({ br: true }); continue; }
      let next = mark;
      if (!mark) {
        const href = child.nodeName === 'A' ? child.getAttribute('href') || '' : '';
        if (/^https?:\/\//i.test(href)) next = `a:${href}`;
        else if (isBold(child)) next = 'b';
        else if (isItalic(child)) next = 'i';
      }
      collectRuns(child, next, runs);
    }
  }
  return runs;
}

function runsToMarkup(runs) {
  let out = '';
  for (const run of runs) {
    if (run.br) { out += '\n'; continue; }
    if (!run.mark) { out += run.text; continue; }
    // Spaces at the edges stay outside the markers.
    const [, lead, core, trail] = run.text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!core) { out += run.text; continue; }
    if (run.mark === 'b') out += `${lead}**${core}**${trail}`;
    else if (run.mark === 'i') out += `${lead}*${core}*${trail}`;
    else {
      const href = run.mark.slice(2);
      out += `${lead}${core === href ? href : `[${core.replace(/[[\]]/g, '')}](${href})`}${trail}`;
    }
  }
  return out.split('\n').map(line => line.trim()).filter(Boolean).join('\n');
}

export function domToMarkup(root) {
  const blocks = [];
  let loose = [];
  const flush = () => {
    if (!loose.length) return;
    const text = runsToMarkup(collectRuns({ childNodes: loose }, null, []));
    if (text) blocks.push(text);
    loose = [];
  };
  const walk = node => {
    for (const child of node.childNodes || []) {
      if (child.nodeType !== 1 || !BLOCKS.has(child.nodeName)) { loose.push(child); continue; }
      flush();
      if (child.nodeName === 'UL' || child.nodeName === 'OL') {
        const items = Array.from(child.childNodes || []).filter(item => item.nodeName === 'LI')
          .map(item => runsToMarkup(collectRuns(item, null, [])).replace(/\n/g, ' ')).filter(Boolean);
        if (items.length) blocks.push(items.map(item => `- ${item}`).join('\n'));
      } else if (Array.from(child.childNodes || []).some(inner => inner.nodeType === 1 && BLOCKS.has(inner.nodeName))) {
        walk(child);
        flush();
      } else {
        const text = runsToMarkup(collectRuns(child, null, []));
        if (text) blocks.push(text);
      }
    }
  };
  walk(root);
  flush();
  return blocks.join('\n\n');
}
