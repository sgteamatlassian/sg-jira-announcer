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
//   settings                  app settings: { claimedDomains, hasLogo }
//   image:logo                the logo (data URL), uploaded under Settings
//   image:<id>                the own picture of one announcement (data URL)
const ANNOUNCEMENTS = 'announcements';
const SETTINGS = 'settings';
const GROUP_CACHE_MS = 10 * 60 * 1000;
const EMAIL_CACHE_MS = 24 * 60 * 60 * 1000;

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

// Fields added after the first version get their defaults on older records.
const loadAll = async () => ((await kvs.get(ANNOUNCEMENTS)) || [])
  .map(a => ({
    ...a, users: a.users || [], excludedGroups: a.excludedGroups || [], mandatory: a.mandatory === true,
    surfaces: core.SURFACES.includes(a.surfaces) ? a.surfaces : 'jira', excludeClaimedDomains: a.excludeClaimedDomains === true,
    image: core.IMAGES.includes(a.image) ? a.image : 'none'
  }));
const loadSettings = async () => ({ claimedDomains: [], hasLogo: false, ...((await kvs.get(SETTINGS)) || {}) });
const imageKey = name => `image:${name}`;
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

async function groupIdsOf(accountId, state, now, accountType) {
  if (state.groups && now - state.groups.at < GROUP_CACHE_MS) return state.groups.ids;
  let groups;
  try {
    groups = await jira(route`/rest/api/3/user/groups?accountId=${accountId}`);
  } catch (error) {
    // Portal-only customers are not Jira users and belong to no Jira group.
    if (accountType !== 'customer') throw error;
    groups = [];
  }
  const ids = groups.map(group => group.groupId).filter(Boolean);
  state.groups = { ids, at: now };
  await kvs.set(userKey(accountId), state);
  return ids;
}

// The domain of the viewer's email address (only the domain is kept, for a day).
// The email endpoint only answers app requests.
async function emailDomainOf(accountId, state, now) {
  if (state.email && now - state.email.at < EMAIL_CACHE_MS) return state.email.domain;
  const result = await jira(route`/rest/api/3/user/email?accountId=${accountId}`);
  const domain = core.emailDomain(result?.email);
  state.email = { domain, at: now };
  await kvs.set(userKey(accountId), state);
  return domain;
}

// Announcements the viewer still has to see on this surface: inside Jira (the
// background script) or in the customer portal (`surface: 'portal'`). Project
// targeting is applied in the browser, because only the page knows which
// project is open.
resolver.define('pending', async ({ payload, context }) => {
  const accountId = context.accountId;
  if (!accountId || accountId === 'unidentified' || context.accountType === 'anonymous') return { items: [] };
  const surface = payload?.surface === 'portal' ? 'portal' : 'jira';
  const now = Date.now();
  const all = await loadAll();
  if (!all.some(a => core.isLive(a, now))) return { items: [] };
  const state = (await kvs.get(userKey(accountId))) || {};
  let open = core.openFor(all, state, now).filter(a => core.shownOn(a, surface));
  let groupIds = [];
  let groupsKnown = true;
  if (open.some(core.needsGroups)) {
    try { groupIds = await groupIdsOf(accountId, state, now, context.accountType); } catch (error) {
      groupsKnown = false;
      console.error('Group lookup failed', error.message);
    }
  }
  const viewer = { domain: null, claimedDomains: [] };
  let emailKnown = true;
  if (open.some(core.needsEmail)) {
    viewer.claimedDomains = (await loadSettings()).claimedDomains;
    if (viewer.claimedDomains.length) {
      try { viewer.domain = await emailDomainOf(accountId, state, now); } catch (error) {
        emailKnown = false;
        console.error('Email lookup failed', error.message);
      }
    }
  }
  // Without the memberships or the email domain an excluded person cannot be
  // recognised: such announcements wait for the next page view instead.
  open = open.filter(a => (groupsKnown || !a.excludedGroups.length) && (emailKnown || !a.excludeClaimedDomains)
    && core.matchesAudience(a, accountId, groupIds, viewer));
  // Mandatory announcements come first.
  open.sort((a, b) => Number(b.mandatory) - Number(a.mandatory));
  return { items: open.map(core.publicView) };
});

async function current(id) {
  return (await loadAll()).find(a => a.id === requireId(id)) || null;
}

resolver.define('acknowledge', async ({ payload, context }) => {
  const accountId = context.accountId;
  const announcement = await current(payload?.id);
  if (!accountId || accountId === 'unidentified' || !announcement) return { ok: false };
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
  if (!accountId || !announcement || !announcement.allowSnooze || announcement.mandatory) return { ok: false };
  const state = (await kvs.get(userKey(accountId))) || {};
  state.snooze = { ...state.snooze, [announcement.id]: { rev: announcement.rev, until: Date.now() + announcement.snoozeHours * 3600 * 1000 } };
  await kvs.set(userKey(accountId), state);
  return { ok: true };
});

// The picture of an announcement, loaded by the popup when it opens (kept out
// of "pending" so page views stay light): `name` is 'logo' or an announcement id.
resolver.define('image', async ({ payload }) => {
  const name = payload?.name === 'logo' ? 'logo' : requireId(payload?.name);
  return { dataUrl: (await kvs.get(imageKey(name))) || null };
});

// "My announcements": what the viewer has confirmed so far.
resolver.define('mine', async ({ context }) => {
  const accountId = context.accountId;
  if (!accountId) return { items: [] };
  const [all, state] = await Promise.all([loadAll(), kvs.get(userKey(accountId))]);
  return { items: core.confirmedBy(all, state) };
});

// ---- Jira administrators (admin page) ---------------------------------------

const prefsKey = accountId => `prefs:${accountId}`;

admin('list', async (payload, context) => {
  const [announcements, prefs, settings] = await Promise.all([loadAll(), kvs.get(prefsKey(context.accountId)), loadSettings()]);
  return { announcements, settings, limits: core.LIMITS, columns: core.normalizeColumns(prefs?.columns, prefs?.known) };
});

// App settings shared by all administrators: the organisation's claimed domains.
admin('saveSettings', async ({ settings }) => {
  const saved = { ...(await loadSettings()), claimedDomains: core.normalizeDomains(settings?.claimedDomains) };
  await kvs.set(SETTINGS, saved);
  return { settings: saved };
});

// The logo for announcements with the picture "Logo"; null removes it.
admin('saveLogo', async ({ dataUrl }) => {
  if (dataUrl == null) await kvs.delete(imageKey('logo'));
  else await kvs.set(imageKey('logo'), core.validateImage(dataUrl));
  const saved = { ...(await loadSettings()), hasLogo: dataUrl != null };
  await kvs.set(SETTINGS, saved);
  return { settings: saved };
});

// The columns this administrator wants to see in the overview.
admin('saveColumns', async ({ columns }, context) => {
  if (!Array.isArray(columns) || columns.some(id => !core.COLUMNS.includes(id))) throw new Error('Invalid columns.');
  const saved = core.normalizeColumns(columns, core.COLUMNS);
  await kvs.set(prefsKey(context.accountId), { columns: saved, known: core.COLUMNS });
  return { columns: saved };
});

// `announcement.imageData`: a newly chosen own picture (data URL); it is stored
// apart from the announcement. Without one, an own picture stays as it was.
admin('save', async ({ announcement }, context) => {
  const all = await loadAll();
  const index = announcement?.id ? all.findIndex(a => a.id === announcement.id) : -1;
  if (announcement?.id && index < 0) throw new Error('This announcement no longer exists.');
  const saved = core.normalizeAnnouncement(announcement, {
    existing: index >= 0 ? all[index] : null, id: randomUUID(), now: Date.now(), actor: context.accountId
  });
  const imageData = announcement.imageData == null ? null : core.validateImage(announcement.imageData);
  if (saved.image === 'custom' && !imageData && !(await kvs.get(imageKey(saved.id)))) throw new Error('Choose a picture to upload, or set Picture to None.');
  if (index >= 0) all[index] = saved; else all.unshift(saved);
  core.assertFits(all);
  if (saved.image === 'custom' && imageData) await kvs.set(imageKey(saved.id), imageData);
  await kvs.set(ANNOUNCEMENTS, all);
  if (saved.image !== 'custom') await kvs.delete(imageKey(saved.id));
  return { announcement: saved };
});

// How many people acknowledged the current revision of each announcement.
// Counted from the read receipts, so it is exact; an announcement that cannot
// be counted within the time budget is reported as null.
admin('ackCounts', async () => {
  const all = await loadAll();
  const deadline = Date.now() + 15000;
  const counts = {};
  const queue = [...all];
  const worker = async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      let count = 0;
      let cursor;
      do {
        if (Date.now() > deadline) { count = null; break; }
        let query = kvs.query().where('key', WhereConditions.beginsWith(`read:${a.id}:`)).limit(100);
        if (cursor) query = query.cursor(cursor);
        const page = await query.getMany();
        count += page.results.filter(entry => entry.value.rev === a.rev).length;
        cursor = page.nextCursor;
      } while (cursor);
      counts[a.id] = count;
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  return { counts };
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
  await kvs.delete(imageKey(id));
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

admin('users', async ({ query }) => {
  const text = typeof query === 'string' ? query.trim().slice(0, 100) : '';
  if (!text) return { users: [] };
  const params = new URLSearchParams({ query: text, maxResults: '20' });
  const result = await jira(route`/rest/api/3/user/search?${params}`, { asUser: true });
  return {
    users: (result || []).filter(user => user.accountType === 'atlassian' && user.active !== false)
      .map(user => ({ id: user.accountId, name: user.displayName }))
  };
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
