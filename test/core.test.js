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

test('audience: nobody named means everyone; otherwise a named person or a group member', () => {
  assert.equal(core.matchesAudience(make(), 'me', []), true);
  const byGroup = make({ groups: [{ id: 'g1', name: 'Agents' }] });
  assert.equal(core.matchesAudience(byGroup, 'me', ['g2']), false);
  assert.equal(core.matchesAudience(byGroup, 'me', ['g2', 'g1']), true);
  const byPerson = make({ users: [{ id: '557058:abc-1', name: 'Me' }] });
  assert.equal(core.matchesAudience(byPerson, '557058:abc-1', []), true);
  assert.equal(core.matchesAudience(byPerson, 'someone-else', ['g1']), false);
  const both = make({ groups: [{ id: 'g1', name: 'Agents' }], users: [{ id: 'me', name: 'Me' }] });
  assert.equal(core.matchesAudience(both, 'me', []), true);
  assert.equal(core.matchesAudience(both, 'other', ['g1']), true);
  assert.equal(core.matchesAudience(both, 'other', []), false);
  // Records saved before people could be named.
  const { users, ...old } = make();
  assert.equal(core.matchesAudience(old, 'me', []), true);
});

test('named people are validated and de-duplicated', () => {
  assert.deepEqual(make({ users: [{ id: 'a:1', name: 'A' }, { id: 'a:1', name: 'A again' }] }).users, [{ id: 'a:1', name: 'A' }]);
  assert.throws(() => make({ users: [{ id: 'not valid!', name: 'X' }] }), /Invalid person/);
  assert.deepEqual(make().users, []);
});

test('the browser never receives the group list or audit fields', () => {
  const view = core.publicView(make({ groups: [{ id: 'g1', name: 'Agents' }], users: [{ id: 'u1', name: 'U' }], projects: ['AS'] }));
  assert.equal('groups' in view, false);
  assert.equal('users' in view, false);
  assert.equal('updatedBy' in view, false);
  assert.deepEqual(view.projects, ['AS']);
});

test('announcements that do not fit into one storage value are rejected', () => {
  const big = make({ body: 'x'.repeat(10000) });
  assert.throws(() => core.assertFits(Array.from({ length: 30 }, () => big)), /no longer fit/);
  core.assertFits([big]);
});

test('saved overview columns: default when nothing valid is stored, fixed order otherwise', () => {
  const all = ['status', 'created', 'audience', 'period', 'acks'];
  assert.deepEqual(core.normalizeColumns(undefined), all);
  assert.deepEqual(core.normalizeColumns(['period', 'bogus']), all);
  assert.deepEqual(core.normalizeColumns(['period', 'updated', 'status'], core.COLUMNS), ['status', 'updated', 'period']);
  assert.deepEqual(core.normalizeColumns([], core.COLUMNS), []);
});

test('a default column added after someone saved their choice shows up for them', () => {
  assert.deepEqual(core.normalizeColumns(['status', 'period']), ['status', 'period', 'acks']);
  assert.deepEqual(core.normalizeColumns(['status', 'period'], ['status', 'created', 'updated', 'audience', 'period']), ['status', 'period', 'acks']);
  assert.deepEqual(core.normalizeColumns(['status'], core.COLUMNS), ['status']);
});

test('"My announcements": confirmed ones only, newest confirmation first, deleted ones gone', () => {
  const a = make({ title: 'A' });
  const b = { ...make({ title: 'B' }), id: '22222222-2222-4222-8222-222222222222', rev: 3, enabled: false };
  const c = { ...make({ title: 'C' }), id: '33333333-3333-4333-8333-333333333333' };
  const state = { acks: {
    [a.id]: { rev: 1, at: '2026-11-01T10:00:00.000Z' },
    [b.id]: { rev: 2, at: '2026-11-20T10:00:00.000Z' },
    'deleted-announcement': { rev: 1, at: '2026-11-22T10:00:00.000Z' }
  } };
  const mine = core.confirmedBy([a, b, c], state);
  assert.deepEqual(mine.map(item => [item.title, item.changed]), [['B', true], ['A', false]]);
  assert.equal('groups' in mine[0], false);
  assert.deepEqual(core.confirmedBy([a], null), []);
});

test('excluded groups: their members never get it, also when named or in an included group', () => {
  const excluded = [{ id: 'ex', name: 'Contractors' }];
  const everyone = make({ excludedGroups: excluded });
  assert.equal(core.matchesAudience(everyone, 'me', []), true);
  assert.equal(core.matchesAudience(everyone, 'me', ['other']), true);
  assert.equal(core.matchesAudience(everyone, 'me', ['other', 'ex']), false);
  const targeted = make({ groups: [{ id: 'g1', name: 'Agents' }], users: [{ id: 'me', name: 'Me' }], excludedGroups: excluded });
  assert.equal(core.matchesAudience(targeted, 'me', ['ex']), false);
  assert.equal(core.matchesAudience(targeted, 'other', ['g1', 'ex']), false);
  assert.equal(core.matchesAudience(targeted, 'other', ['g1']), true);
  assert.equal(core.needsGroups(everyone), true);
  assert.equal(core.needsGroups(make()), false);
  assert.deepEqual(make().excludedGroups, []);
  assert.throws(() => make({ excludedGroups: 'ex' }), /Excluded groups must be a list/);
});

test('mandatory: always a popup, never "Remind me later"; the browser learns it is mandatory', () => {
  const a = make({ mandatory: true, display: 'flag', allowSnooze: true });
  assert.equal(a.mandatory, true);
  assert.equal(a.display, 'dialog');
  assert.equal(a.allowSnooze, false);
  assert.equal(core.publicView(a).mandatory, true);
  assert.equal('excludedGroups' in core.publicView(a), false);
  assert.equal(make({ allowSnooze: true }).allowSnooze, true);
  assert.equal(make().mandatory, false);
});

test('where: Jira only by default, portal only, or both', () => {
  assert.equal(make().surfaces, 'jira');
  assert.equal(make({ surfaces: 'nonsense' }).surfaces, 'jira');
  assert.equal(core.shownOn(make(), 'jira'), true);
  assert.equal(core.shownOn(make(), 'portal'), false);
  assert.equal(core.shownOn(make({ surfaces: 'portal' }), 'jira'), false);
  assert.equal(core.shownOn(make({ surfaces: 'portal' }), 'portal'), true);
  assert.equal(core.shownOn(make({ surfaces: 'both' }), 'jira'), true);
  assert.equal(core.shownOn(make({ surfaces: 'both' }), 'portal'), true);
  const { surfaces, ...old } = make();
  assert.equal(core.shownOn(old, 'jira'), true);
  assert.equal(core.shownOn(old, 'portal'), false);
});

test('claimed domains: entered once, matched with subdomains, case-insensitive', () => {
  assert.deepEqual(core.normalizeDomains('Example.com\n@example.org, example.com;  '), ['example.com', 'example.org']);
  assert.throws(() => core.normalizeDomains(['not a domain']), /not a valid domain/);
  assert.equal(core.emailDomain('Jane.Doe@Mail.Example.COM'), 'mail.example.com');
  assert.equal(core.emailDomain(''), null);
  assert.equal(core.emailDomain(undefined), null);
  assert.equal(core.isClaimed('mail.example.com', ['example.com']), true);
  assert.equal(core.isClaimed('notexample.com', ['example.com']), false);
  assert.equal(core.isClaimed(null, ['example.com']), false);
});

test('exclude users of claimed domains: only when the announcement says so', () => {
  const claimed = { domain: 'example.com', claimedDomains: ['example.com'] };
  const external = { domain: 'customer.net', claimedDomains: ['example.com'] };
  const a = make({ excludeClaimedDomains: true });
  assert.equal(core.needsEmail(a), true);
  assert.equal(core.matchesAudience(a, 'me', [], claimed), false);
  assert.equal(core.matchesAudience(a, 'me', [], external), true);
  assert.equal(core.matchesAudience(make(), 'me', [], claimed), true);
  assert.equal(core.needsEmail(make()), false);
  const named = make({ excludeClaimedDomains: true, users: [{ id: 'me', name: 'Me' }] });
  assert.equal(core.matchesAudience(named, 'me', [], claimed), false);
});
