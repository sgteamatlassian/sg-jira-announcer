import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectKeysCsv } from '../static/ui/src/csv.mjs';
import { projectKeyFromContext, matchesProject } from '../static/ui/src/targeting.mjs';
import { parseRichText, toPlainText } from '../static/ui/src/richtext.mjs';

test('CSV: one key per line, with BOM, blank lines, lower case and duplicates', () => {
  const r = parseProjectKeysCsv('﻿SGSD\r\n\r\nas\r\nSL\nSGSD\n');
  assert.deepEqual(r.keys, ['SGSD', 'AS', 'SL']);
  assert.equal(r.duplicates, 1);
});

test('CSV: a single line of keys, comma or semicolon separated', () => {
  assert.deepEqual(parseProjectKeysCsv('SGSD, AS,SL').keys, ['SGSD', 'AS', 'SL']);
  assert.deepEqual(parseProjectKeysCsv('SGSD;AS;SL').keys, ['SGSD', 'AS', 'SL']);
});

test('CSV: the column named key is used, other columns are ignored', () => {
  const r = parseProjectKeysCsv('Name;Project Key;Lead\n"Service Desk; internal";SGSD;Anna\nSales;SL;Ben\n');
  assert.deepEqual(r.keys, ['SGSD', 'SL']);
  assert.equal(r.column, 'Project Key');
  assert.deepEqual(parseProjectKeysCsv('Projektschlüssel,Name\nAS,Apps\n').keys, ['AS']);
});

test('CSV: a table without a key header uses the first column', () => {
  const r = parseProjectKeysCsv('SGSD,Service Desk\nAS,Apps\n');
  assert.deepEqual(r.keys, ['SGSD', 'AS']);
  assert.equal(r.column, 'first column');
});

test('CSV: a lone header line is skipped and invalid cells are reported', () => {
  assert.deepEqual(parseProjectKeysCsv('key\nSGSD\nAS').keys, ['SGSD', 'AS']);
  const r = parseProjectKeysCsv('SGSD\n12AB\nhello world\nA\n');
  assert.deepEqual(r.keys, ['SGSD']);
  assert.deepEqual(r.invalid, ['12AB', 'hello world', 'A']);
  assert.deepEqual(parseProjectKeysCsv('').keys, []);
});

test('the open project comes from the context or from the URL', () => {
  const at = location => projectKeyFromContext({ location });
  assert.equal(projectKeyFromContext({ project: { key: 'sgsd' }, location: 'https://x/browse/AS-1' }), 'SGSD');
  assert.equal(at('https://x.atlassian.net/browse/AS-123'), 'AS');
  assert.equal(at('https://x.atlassian.net/jira/servicedesk/projects/SGSD/queues/custom/1'), 'SGSD');
  assert.equal(at('https://x.atlassian.net/jira/software/c/projects/SL/boards/4?selectedIssue=SL-9'), 'SL');
  assert.equal(at('https://x.atlassian.net/jira/software/projects/A1_B'), 'A1_B');
  assert.equal(at('https://x.atlassian.net/jira/dashboards/10000'), null);
  assert.equal(at('https://x.atlassian.net/jira/projects?page=1'), null);
});

test('project targeting: an empty list matches everywhere', () => {
  assert.equal(matchesProject({ projects: [] }, null), true);
  assert.equal(matchesProject({ projects: ['AS'] }, null), false);
  assert.equal(matchesProject({ projects: ['AS'] }, 'SL'), false);
  assert.equal(matchesProject({ projects: ['AS', 'SL'] }, 'SL'), true);
  assert.equal(matchesProject({ projects: ['AS'], mandatory: true }, 'SL'), true);
  assert.equal(matchesProject({ projects: ['AS'], mandatory: true }, null), true);
});

test('rich text: paragraphs, bullets, emphasis and only http(s) links', () => {
  const blocks = parseRichText('Hello **all**,\nsecond line\n\n- one\n- [docs](https://example.com/a)\n\n[bad](javascript:alert(1)) see https://example.com/x.');
  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[0].lines[0], [{ text: 'Hello ' }, { text: 'all', bold: true }, { text: ',' }]);
  assert.equal(blocks[0].lines.length, 2);
  assert.deepEqual(blocks[1].items[1], [{ text: 'docs', href: 'https://example.com/a' }]);
  const links = blocks[2].lines[0].filter(part => part.href);
  assert.deepEqual(links, [{ text: 'https://example.com/x', href: 'https://example.com/x' }]);
  assert.equal(toPlainText('Hi **you**\n\n- a\n- b'), 'Hi you\n\n• a\n• b');
});

// Minimal stand-ins for DOM nodes.
const t = value => ({ nodeType: 3, nodeValue: value });
const el = (name, children = [], attrs = {}, style = {}) => ({
  nodeType: 1, nodeName: name, childNodes: children.map(child => (typeof child === 'string' ? t(child) : child)),
  getAttribute: key => attrs[key] ?? null, style
});

test('visual editor: DOM is written back as the text format', async () => {
  const { domToMarkup } = await import('../static/ui/src/richtext.mjs');
  const root = el('DIV', [
    el('P', ['Hello ', el('STRONG', ['all ']), 'and ', el('EM', ['you']), el('BR'), 'second line']),
    el('P', [el('BR')]),
    el('UL', [el('LI', ['one']), el('LI', [el('A', ['docs'], { href: 'https://example.com/a' })])]),
    el('DIV', ['see ', el('A', ['https://example.com/x'], { href: 'https://example.com/x' }), ' or ', el('A', ['bad'], { href: 'javascript:alert(1)' })]),
    'loose ', el('SPAN', ['bold'], {}, { fontWeight: '700' }), ' text'
  ]);
  assert.equal(domToMarkup(root), [
    'Hello **all** and *you*\nsecond line',
    '- one\n- [docs](https://example.com/a)',
    'see https://example.com/x or bad',
    'loose **bold** text'
  ].join('\n\n'));
});

test('visual editor: nested emphasis is flattened and adjacent runs are merged', async () => {
  const { domToMarkup, parseRichText } = await import('../static/ui/src/richtext.mjs');
  const root = el('DIV', [el('P', [el('B', ['very ', el('I', ['important'])]), el('B', [' note'])]), el('DIV', [el('DIV', ['a']), el('DIV', ['b'])])]);
  const markup = domToMarkup(root);
  assert.equal(markup, '**very important note**\n\na\n\nb');
  assert.deepEqual(parseRichText(markup)[0].lines[0], [{ text: 'very important note', bold: true }]);
});

test('overview: live announcements first, then by creation date; filter by status and text', async () => {
  const { filterAndSort, countByStatus, statusOf } = await import('../static/ui/src/overview.mjs');
  const now = Date.parse('2026-11-25T12:00:00Z');
  const a = (title, extra) => ({ title, body: '', projects: [], groups: [], enabled: true, startAt: null, endAt: null, ...extra });
  const list = [
    a('Old live', { createdAt: '2026-01-01T00:00:00Z' }),
    a('Disabled', { createdAt: '2026-11-20T00:00:00Z', enabled: false }),
    a('Ended', { createdAt: '2026-11-21T00:00:00Z', endAt: '2026-11-22T00:00:00Z' }),
    a('Scheduled', { createdAt: '2026-11-22T00:00:00Z', startAt: '2026-12-01T00:00:00Z', projects: ['SGSD'] }),
    a('New live', { createdAt: '2026-11-24T00:00:00Z', body: 'Maintenance', groups: [{ id: 'g', name: 'sg-agents' }] })
  ];
  const titles = options => filterAndSort(list, options, now).map(row => row.announcement.title);
  assert.equal(statusOf(list[2], now), 'ended');
  assert.deepEqual(titles(), ['New live', 'Old live', 'Scheduled', 'Disabled', 'Ended']);
  assert.deepEqual(titles({ sort: 'newest' }), ['New live', 'Scheduled', 'Ended', 'Disabled', 'Old live']);
  assert.deepEqual(titles({ sort: 'title' }), ['Disabled', 'Ended', 'New live', 'Old live', 'Scheduled']);
  assert.deepEqual(titles({ status: 'live' }), ['New live', 'Old live']);
  assert.deepEqual(titles({ search: 'sgsd' }), ['Scheduled']);
  assert.deepEqual(titles({ search: 'AGENTS maint' }), ['New live']);
  assert.deepEqual(titles({ search: 'live', status: 'disabled' }), []);
  assert.deepEqual(countByStatus(list, now), { all: 5, live: 2, scheduled: 1, disabled: 1, ended: 1 });
});
