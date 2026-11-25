'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core');

const NOW = Date.parse('2026-11-25T12:00:00Z');
const make = (input = {}, extra = {}) => core.normalizeAnnouncement({ title: 'Maintenance', enabled: true, ...input }, { id: '11111111-1111-4111-8111-111111111111', now: NOW, actor: 'admin', ...extra });

test('project keys are upper-cased, de-duplicated and validated', () => {
  assert.deepEqual(make({ projects: ['sgsd', 'AS', ' SGSD '] }).projects, ['SGSD', 'AS']);
  assert.throws(() => make({ projects: ['OK', 'not a key'] }), /not a valid project key/);
  assert.throws(() => make({ projects: Array.from({ length: 2001 }, (_, i) => `P${i}`) }), /At most 2000/);
});

test('a title is required and defaults are applied', () => {
  assert.throws(() => make({ title: '  ' }), /Title is required/);
  const a = make({ display: 'nonsense', buttonText: '' });
  assert.equal(a.display, 'dialog');
  assert.equal(a.buttonText, 'Got it');
  assert.equal(a.rev, 1);
});

test('editing keeps id, revision and creation time from storage, not from the client', () => {
  const existing = { ...make(), rev: 4, createdAt: '2026-01-01T00:00:00.000Z' };
  const edited = make({ id: 'forged', rev: 99, title: 'New' }, { existing, id: 'unused' });
  assert.equal(edited.id, existing.id);
  assert.equal(edited.rev, 4);
  assert.equal(edited.createdAt, existing.createdAt);
});

test('the end must be after the start', () => {
  assert.throws(() => make({ startAt: '2026-12-02T00:00:00Z', endAt: '2026-12-01T00:00:00Z' }), /End must be after start/);
});

test('an announcement is live only when enabled and inside its period', () => {
  assert.equal(core.isLive(make(), NOW), true);
  assert.equal(core.isLive(make({ enabled: false }), NOW), false);
  assert.equal(core.isLive(make({ startAt: '2026-11-26T00:00:00Z' }), NOW), false);
  assert.equal(core.isLive(make({ endAt: '2026-11-25T12:00:00Z' }), NOW), false);
  assert.equal(core.isLive(make({ startAt: '2026-11-25T00:00:00Z', endAt: '2026-11-26T00:00:00Z' }), NOW), true);
});

test('acknowledged and snoozed announcements are not shown, until the revision changes', () => {
  const a = make();
  assert.equal(core.openFor([a], {}, NOW).length, 1);
  assert.equal(core.openFor([a], { acks: { [a.id]: { rev: 1 } } }, NOW).length, 0);
  assert.equal(core.openFor([{ ...a, rev: 2 }], { acks: { [a.id]: { rev: 1 } } }, NOW).length, 1);
  assert.equal(core.openFor([a], { snooze: { [a.id]: { rev: 1, until: NOW + 1 } } }, NOW).length, 0);
  assert.equal(core.openFor([a], { snooze: { [a.id]: { rev: 1, until: NOW } } }, NOW).length, 1);
});

test('group targeting: no groups means everyone', () => {
  assert.equal(core.matchesGroups(make(), []), true);
  const a = make({ groups: [{ id: 'g1', name: 'Agents' }] });
  assert.equal(core.matchesGroups(a, ['g2']), false);
  assert.equal(core.matchesGroups(a, ['g2', 'g1']), true);
});

test('the browser never receives the group list or audit fields', () => {
  const view = core.publicView(make({ groups: [{ id: 'g1', name: 'Agents' }], projects: ['AS'] }));
  assert.equal('groups' in view, false);
  assert.equal('updatedBy' in view, false);
  assert.deepEqual(view.projects, ['AS']);
});

test('announcements that do not fit into one storage value are rejected', () => {
  const big = make({ body: 'x'.repeat(10000) });
  assert.throws(() => core.assertFits(Array.from({ length: 30 }, () => big)), /no longer fit/);
  core.assertFits([big]);
});
