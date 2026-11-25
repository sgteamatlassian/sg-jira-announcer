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
