'use strict';

const { randomUUID } = require('node:crypto');
const Resolver = require('@forge/resolver').default;
const api = require('@forge/api');
const { route } = api;
const { kvs, WhereConditions } = require('@forge/kvs');
const core = require('./core');

const resolver = new Resolver();

// Storage layout
//   announcements             all announcements (array) - one read per page view
//   user:<accountId>          { acks, snooze, groups } of one person
//   read:<id>:<accountId>     one acknowledgement, for the "who has read" report
//   prefs:<accountId>         an administrator's view settings (visible columns)
const ANNOUNCEMENTS = 'announcements';
const GROUP_CACHE_MS = 10 * 60 * 1000;

async function jira(path, { asUser = false, ...options } = {}) {
  const response = await (asUser ? api.asUser() : api.asApp()).requestJira(path, {
    ...options, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }
  });
  if (!response.ok) throw new Error(`Jira request failed (HTTP ${response.status}).`);
  return response.status === 204 ? null : response.json();
}

async function ensureAdmin() {
  const result = await jira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`, { asUser: true });
  if (!result.permissions?.ADMINISTER?.havePermission) throw new Error('Only Jira administrators can use this feature.');
}

const loadAll = async () => (await kvs.get(ANNOUNCEMENTS)) || [];
const userKey = accountId => `user:${accountId}`;
const readKey = (id, accountId) => `read:${id}:${accountId}`;

function requireId(id) {
  if (typeof id !== 'string' || !core.ID.test(id)) throw new Error('Invalid announcement.');
  return id;
}

// Authorization is enforced server-side on every admin resolver.
function admin(name, callback) {
  resolver.define(name, async request => {
    await ensureAdmin();
    return callback(request.payload || {}, request.context);
  });
}

// ---- Every Jira user (background script) ------------------------------------

async function groupIdsOf(accountId, state, now) {
  if (state.groups && now - state.groups.at < GROUP_CACHE_MS) return state.groups.ids;
  const groups = await jira(route`/rest/api/3/user/groups?accountId=${accountId}`);
  const ids = groups.map(group => group.groupId).filter(Boolean);
  state.groups = { ids, at: now };
  await kvs.set(userKey(accountId), state);
  return ids;
}

// Announcements the viewer still has to see. Project targeting is applied in
// the browser, because only the page knows which project is open.
resolver.define('pending', async ({ context }) => {
  const accountId = context.accountId;
  if (!accountId) return { items: [] };
  const now = Date.now();
  const all = await loadAll();
  if (!all.some(a => core.isLive(a, now))) return { items: [] };
  const state = (await kvs.get(userKey(accountId))) || {};
  let open = core.openFor(all, state, now);
  if (open.some(a => a.groups.length)) {
    let ids = [];
    try { ids = await groupIdsOf(accountId, state, now); } catch (error) { console.error('Group lookup failed', error.message); }
    open = open.filter(a => core.matchesGroups(a, ids));
  }
  return { items: open.map(core.publicView) };
});

async function current(id) {
  return (await loadAll()).find(a => a.id === requireId(id)) || null;
}

resolver.define('acknowledge', async ({ payload, context }) => {
  const accountId = context.accountId;
  const announcement = await current(payload?.id);
  if (!accountId || !announcement) return { ok: false };
  const at = new Date().toISOString();
  const state = (await kvs.get(userKey(accountId))) || {};
  state.acks = { ...state.acks, [announcement.id]: { rev: announcement.rev, at } };
  if (state.snooze) delete state.snooze[announcement.id];
  await kvs.set(userKey(accountId), state);
  await kvs.set(readKey(announcement.id, accountId), { accountId, rev: announcement.rev, at });
  return { ok: true };
});

resolver.define('snooze', async ({ payload, context }) => {
  const accountId = context.accountId;
  const announcement = await current(payload?.id);
  if (!accountId || !announcement || !announcement.allowSnooze) return { ok: false };
  const state = (await kvs.get(userKey(accountId))) || {};
  state.snooze = { ...state.snooze, [announcement.id]: { rev: announcement.rev, until: Date.now() + announcement.snoozeHours * 3600 * 1000 } };
  await kvs.set(userKey(accountId), state);
  return { ok: true };
});

// ---- Jira administrators (admin page) ---------------------------------------

const prefsKey = accountId => `prefs:${accountId}`;

admin('list', async (payload, context) => {
  const [announcements, prefs] = await Promise.all([loadAll(), kvs.get(prefsKey(context.accountId))]);
  return { announcements, limits: core.LIMITS, columns: core.normalizeColumns(prefs?.columns) };
});

// The columns this administrator wants to see in the overview.
admin('saveColumns', async ({ columns }, context) => {
  if (!Array.isArray(columns) || columns.some(id => !core.COLUMNS.includes(id))) throw new Error('Invalid columns.');
  const saved = core.normalizeColumns(columns);
  await kvs.set(prefsKey(context.accountId), { columns: saved });
  return { columns: saved };
});

admin('save', async ({ announcement }, context) => {
  const all = await loadAll();
  const index = announcement?.id ? all.findIndex(a => a.id === announcement.id) : -1;
  if (announcement?.id && index < 0) throw new Error('This announcement no longer exists.');
  const saved = core.normalizeAnnouncement(announcement, {
    existing: index >= 0 ? all[index] : null, id: randomUUID(), now: Date.now(), actor: context.accountId
  });
  if (index >= 0) all[index] = saved; else all.unshift(saved);
  core.assertFits(all);
  await kvs.set(ANNOUNCEMENTS, all);
  return { announcement: saved };
});

// Shows the announcement again to everyone who has already acknowledged it.
admin('resetAcknowledgements', async ({ id }) => {
  const all = await loadAll();
  const announcement = all.find(a => a.id === requireId(id));
  if (!announcement) throw new Error('This announcement no longer exists.');
  announcement.rev += 1;
  await kvs.set(ANNOUNCEMENTS, all);
  return { announcement };
});

admin('remove', async ({ id }) => {
  requireId(id);
  await kvs.set(ANNOUNCEMENTS, (await loadAll()).filter(a => a.id !== id));
  // Best effort: the read receipts of a deleted announcement are never shown again.
  const deadline = Date.now() + 15000;
  let cursor;
  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith(`read:${id}:`)).limit(50);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    await Promise.all(page.results.map(entry => kvs.delete(entry.key)));
    cursor = page.nextCursor;
  } while (cursor && Date.now() < deadline);
  return { ok: true };
});

// One page of people who acknowledged the current revision.
admin('readers', async ({ id, cursor }) => {
  const announcement = await current(id);
  if (!announcement) throw new Error('This announcement no longer exists.');
  if (cursor != null && (typeof cursor !== 'string' || cursor.length > 3000)) throw new Error('Invalid cursor.');
  let query = kvs.query().where('key', WhereConditions.beginsWith(`read:${announcement.id}:`)).limit(50);
  if (cursor) query = query.cursor(cursor);
  const page = await query.getMany();
  const readers = page.results.map(entry => entry.value).filter(value => value.rev === announcement.rev);
  const names = new Map();
  if (readers.length) {
    const params = new URLSearchParams({ maxResults: '50' });
    for (const reader of readers) params.append('accountId', reader.accountId);
    try {
      const users = await jira(route`/rest/api/3/user/bulk?${params}`);
      for (const user of users.values || []) names.set(user.accountId, user.displayName);
    } catch (error) { console.error('User lookup failed', error.message); }
  }
  return {
    readers: readers.map(reader => ({ accountId: reader.accountId, displayName: names.get(reader.accountId) || reader.accountId, at: reader.at })),
    cursor: page.nextCursor || null
  };
});

admin('groups', async ({ query }) => {
  const params = new URLSearchParams({ query: typeof query === 'string' ? query.slice(0, 100) : '', maxResults: '20' });
  const result = await jira(route`/rest/api/3/groups/picker?${params}`, { asUser: true });
  return { groups: (result.groups || []).map(group => ({ id: group.groupId, name: group.name })) };
});

// Checks up to 50 project keys (one chunk of a CSV import) against Jira, with
// the administrator's own permissions.
admin('checkProjects', async ({ keys }) => {
  const wanted = core.normalizeProjects(keys);
  if (wanted.length > 50) throw new Error('At most 50 project keys per request.');
  if (!wanted.length) return { found: [], unknown: [] };
  const params = new URLSearchParams({ maxResults: '50' });
  for (const key of wanted) params.append('keys', key);
  const page = await jira(route`/rest/api/3/project/search?${params}`, { asUser: true });
  const found = (page.values || []).map(project => ({ key: project.key, name: project.name }));
  const known = new Set(found.map(project => project.key));
  return { found, unknown: wanted.filter(key => !known.has(key)) };
});

exports.handler = resolver.getDefinitions();
