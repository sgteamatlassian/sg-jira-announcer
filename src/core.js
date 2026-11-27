'use strict';

// Pure rules of the announcer: validation of an announcement and the decision
// whether a given person has to see it. No Forge imports, so it runs in tests.

const DISPLAYS = ['dialog', 'flag'];
const SIZES = ['small', 'medium', 'large'];
const APPEARANCES = ['info', 'success', 'warning', 'error'];
// Where it appears: inside Jira, in the JSM customer portal, or both.
const SURFACES = ['jira', 'portal', 'both'];
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,254}$/;
const ID = /^[a-f0-9-]{36}$/;

const LIMITS = {
  title: 200,
  body: 10000,
  buttonText: 40,
  groups: 100,
  users: 200,
  projects: 2000,
  announcements: 100,
  domains: 200,
  // One Forge storage value may hold 240 KiB; all announcements share one key.
  totalBytes: 200 * 1024
};

function text(value, name, max, { required = false } = {}) {
  if (value == null) value = '';
  if (typeof value !== 'string') throw new Error(`${name} must be text.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new Error(`${name} is required.`);
  if (trimmed.length > max) throw new Error(`${name} is longer than ${max} characters.`);
  return trimmed;
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function instant(value, name) {
  if (value == null || value === '') return null;
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) throw new Error(`${name} is not a valid date.`);
  return new Date(time).toISOString();
}

function normalizeProjects(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('Projects must be a list of project keys.');
  const keys = [];
  const seen = new Set();
  for (const entry of value) {
    const key = typeof entry === 'string' ? entry.trim().toUpperCase() : '';
    if (!PROJECT_KEY.test(key)) throw new Error(`"${String(entry).slice(0, 40)}" is not a valid project key.`);
    if (!seen.has(key)) { seen.add(key); keys.push(key); }
  }
  if (keys.length > LIMITS.projects) throw new Error(`At most ${LIMITS.projects} projects per announcement.`);
  return keys;
}

function normalizeGroups(value, label = 'groups') {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label[0].toUpperCase()}${label.slice(1)} must be a list.`);
  const groups = [];
  const seen = new Set();
  for (const entry of value) {
    const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    if (!id || id.length > 200 || name.length > 300) throw new Error('Invalid group.');
    if (!seen.has(id)) { seen.add(id); groups.push({ id, name: name || id }); }
  }
  if (groups.length > LIMITS.groups) throw new Error(`At most ${LIMITS.groups} ${label} per announcement.`);
  return groups;
}

function normalizeUsers(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('People must be a list.');
  const users = [];
  const seen = new Set();
  for (const entry of value) {
    const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
    const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
    if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(id) || name.length > 300) throw new Error('Invalid person.');
    if (!seen.has(id)) { seen.add(id); users.push({ id, name: name || id }); }
  }
  if (users.length > LIMITS.users) throw new Error(`At most ${LIMITS.users} people per announcement.`);
  return users;
}

// Returns the stored form of an announcement. `existing` is the stored record
// when editing: id, revision and creation time are never taken from the client.
function normalizeAnnouncement(input, { existing = null, id, now, actor }) {
  if (!input || typeof input !== 'object') throw new Error('Invalid announcement.');
  const startAt = instant(input.startAt, 'Start');
  const endAt = instant(input.endAt, 'End');
  if (startAt && endAt && Date.parse(endAt) <= Date.parse(startAt)) throw new Error('End must be after start.');
  const snoozeHours = Number(input.snoozeHours);
  // Mandatory: always a popup, on every Jira page, without "Remind me later".
  const mandatory = input.mandatory === true;
  const stamp = new Date(now).toISOString();
  return {
    id: existing ? existing.id : id,
    rev: existing ? existing.rev : 1,
    title: text(input.title, 'Title', LIMITS.title, { required: true }),
    body: text(input.body, 'Message', LIMITS.body),
    mandatory,
    surfaces: oneOf(input.surfaces, SURFACES, 'jira'),
    display: mandatory ? 'dialog' : oneOf(input.display, DISPLAYS, 'dialog'),
    size: oneOf(input.size, SIZES, 'medium'),
    appearance: oneOf(input.appearance, APPEARANCES, 'info'),
    buttonText: text(input.buttonText, 'Button text', LIMITS.buttonText) || 'Got it',
    allowSnooze: !mandatory && input.allowSnooze === true,
    snoozeHours: Number.isFinite(snoozeHours) && snoozeHours >= 1 && snoozeHours <= 720 ? Math.round(snoozeHours) : 24,
    enabled: input.enabled === true,
    startAt,
    endAt,
    groups: normalizeGroups(input.groups),
    users: normalizeUsers(input.users),
    excludedGroups: normalizeGroups(input.excludedGroups, 'excluded groups'),
    excludeClaimedDomains: input.excludeClaimedDomains === true,
    projects: normalizeProjects(input.projects),
    createdAt: existing ? existing.createdAt : stamp,
    updatedAt: stamp,
    updatedBy: actor || null
  };
}

function assertFits(announcements) {
  if (announcements.length > LIMITS.announcements) throw new Error(`At most ${LIMITS.announcements} announcements. Delete old ones first.`);
  if (Buffer.byteLength(JSON.stringify(announcements), 'utf8') > LIMITS.totalBytes) {
    throw new Error('The announcements no longer fit into the app storage. Delete old announcements or shorten the texts and project lists.');
  }
}

// Enabled and inside its time window.
function isLive(announcement, now) {
  if (!announcement.enabled) return false;
  if (announcement.startAt && now < Date.parse(announcement.startAt)) return false;
  if (announcement.endAt && now >= Date.parse(announcement.endAt)) return false;
  return true;
}

// Live announcements this person has neither acknowledged (in the current
// revision) nor snoozed. Group and project targeting come afterwards.
function openFor(announcements, state, now) {
  const acks = state?.acks || {};
  const snooze = state?.snooze || {};
  return announcements.filter(a => isLive(a, now)
    && !(acks[a.id] && acks[a.id].rev === a.rev)
    && !(snooze[a.id] && snooze[a.id].rev === a.rev && now < snooze[a.id].until));
}

// The claimed domains of the organisation, as an administrator entered them
// in the app settings: lower case, without "@", de-duplicated.
function normalizeDomains(value) {
  if (value == null) return [];
  const entries = Array.isArray(value) ? value : String(value).split(/[\s,;]+/);
  const domains = [];
  for (const entry of entries) {
    const domain = String(entry).trim().toLowerCase().replace(/^@/, '');
    if (!domain) continue;
    if (!DOMAIN.test(domain)) throw new Error(`"${domain.slice(0, 60)}" is not a valid domain.`);
    if (!domains.includes(domain)) domains.push(domain);
  }
  if (domains.length > LIMITS.domains) throw new Error(`At most ${LIMITS.domains} domains.`);
  return domains;
}

// The domain of an email address, lower case; null when there is none.
function emailDomain(email) {
  const at = typeof email === 'string' ? email.lastIndexOf('@') : -1;
  return at > 0 ? email.slice(at + 1).trim().toLowerCase() || null : null;
}

// A domain counts as claimed when it is one of the domains or a subdomain of one.
function isClaimed(domain, claimedDomains) {
  return !!domain && claimedDomains.some(claimed => domain === claimed || domain.endsWith(`.${claimed}`));
}

// Inside Jira or in the customer portal? Older announcements are Jira only.
function shownOn(announcement, surface) {
  const surfaces = announcement.surfaces || 'jira';
  return surfaces === 'both' || surfaces === surface;
}

// Who gets it: members of an excluded group never, and - when the announcement
// says so - nobody with an email address at a claimed domain. Otherwise nobody
// named = everyone, else the person must be one of the named people or a member
// of one of the groups. (Older announcements lack the newer fields.)
// `viewer`: { domain, claimedDomains } for the claimed-domain rule.
function matchesAudience(announcement, accountId, groupIds, viewer = {}) {
  if ((announcement.excludedGroups || []).some(group => groupIds.includes(group.id))) return false;
  if (announcement.excludeClaimedDomains && isClaimed(viewer.domain, viewer.claimedDomains || [])) return false;
  const users = announcement.users || [];
  if (!announcement.groups.length && !users.length) return true;
  return users.some(user => user.id === accountId) || announcement.groups.some(group => groupIds.includes(group.id));
}

// The announcements a person has confirmed, newest confirmation first, for
// their "My announcements" page. Deleted announcements are gone; `changed`
// says that the text was shown again to everyone after they confirmed it.
function confirmedBy(announcements, state) {
  const acks = state?.acks || {};
  return announcements
    .filter(a => acks[a.id])
    .map(a => ({
      id: a.id, title: a.title, body: a.body, size: a.size, appearance: a.appearance,
      confirmedAt: acks[a.id].at || null, changed: acks[a.id].rev !== a.rev
    }))
    .sort((a, b) => (Date.parse(b.confirmedAt) || 0) - (Date.parse(a.confirmedAt) || 0));
}

// Does deciding the audience need the viewer's group memberships?
const needsGroups = announcement => announcement.groups.length > 0 || (announcement.excludedGroups || []).length > 0;
// ... or the viewer's email domain?
const needsEmail = announcement => announcement.excludeClaimedDomains === true;

// Optional columns of the admin overview; the title and the row menu are always there.
const COLUMNS = ['status', 'created', 'updated', 'audience', 'period', 'acks'];
const DEFAULT_COLUMNS = ['status', 'created', 'audience', 'period', 'acks'];
// The columns that existed when choices were first saved without a `known` list.
const FIRST_COLUMNS = ['status', 'created', 'updated', 'audience', 'period'];

// A person's saved column choice, in the fixed column order. `known` is the
// list of columns that existed when they chose: a default column added later
// shows up for them too. Anything invalid (nothing saved, unknown ids) gives
// the default.
function normalizeColumns(value, known) {
  if (!Array.isArray(value) || value.some(id => !COLUMNS.includes(id))) return [...DEFAULT_COLUMNS];
  const seen = Array.isArray(known) ? known : FIRST_COLUMNS;
  return COLUMNS.filter(id => value.includes(id) || (!seen.includes(id) && DEFAULT_COLUMNS.includes(id)));
}

// What the browser gets: no audit fields, no group list.
function publicView(a) {
  return {
    id: a.id, rev: a.rev, title: a.title, body: a.body, display: a.display, size: a.size,
    appearance: a.appearance, buttonText: a.buttonText, allowSnooze: a.allowSnooze,
    snoozeHours: a.snoozeHours, projects: a.projects, mandatory: a.mandatory === true
  };
}

module.exports = {
  LIMITS, PROJECT_KEY, ID, normalizeAnnouncement, normalizeProjects, assertFits,
  isLive, openFor, matchesAudience, needsGroups, needsEmail, publicView,
  SURFACES, shownOn, normalizeDomains, emailDomain, isClaimed, confirmedBy, COLUMNS, normalizeColumns
};
