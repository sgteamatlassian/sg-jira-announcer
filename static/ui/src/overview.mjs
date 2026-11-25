// The announcement list on the admin page: status, filter and order.

export const STATUSES = [
  { id: 'live', label: 'Live', tone: 'success' },
  { id: 'scheduled', label: 'Scheduled', tone: 'info' },
  { id: 'disabled', label: 'Disabled', tone: 'neutral' },
  { id: 'ended', label: 'Ended', tone: 'neutral' }
];
const RANK = Object.fromEntries(STATUSES.map((status, index) => [status.id, index]));

export function statusOf(announcement, now = Date.now()) {
  if (!announcement.enabled) return 'disabled';
  if (announcement.startAt && now < Date.parse(announcement.startAt)) return 'scheduled';
  if (announcement.endAt && now >= Date.parse(announcement.endAt)) return 'ended';
  return 'live';
}

export const SORTS = [
  { id: 'active', label: 'Active first' },
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'title', label: 'Title A–Z' }
];

const created = announcement => Date.parse(announcement.createdAt) || 0;

// `status` is a status id or 'all'; `search` matches title, text, project
// keys and group names. The default order puts live announcements on top,
// then scheduled, disabled and ended ones - newest first within each.
export function filterAndSort(announcements, { status = 'all', search = '', sort = 'active' } = {}, now = Date.now()) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = announcements
    .map(announcement => ({ announcement, status: statusOf(announcement, now) }))
    .filter(row => status === 'all' || row.status === status)
    .filter(({ announcement: a }) => {
      if (!words.length) return true;
      const haystack = [a.title, a.body, ...(a.projects || []), ...(a.groups || []).map(group => group.name)].join('\n').toLowerCase();
      return words.every(word => haystack.includes(word));
    });
  const newest = (a, b) => created(b.announcement) - created(a.announcement);
  const compare = {
    active: (a, b) => RANK[a.status] - RANK[b.status] || newest(a, b),
    newest,
    oldest: (a, b) => -newest(a, b),
    title: (a, b) => a.announcement.title.localeCompare(b.announcement.title, undefined, { sensitivity: 'base' }) || newest(a, b)
  }[sort] || newest;
  return rows.sort(compare);
}

export function countByStatus(announcements, now = Date.now()) {
  const counts = { all: announcements.length };
  for (const status of STATUSES) counts[status.id] = 0;
  for (const announcement of announcements) counts[statusOf(announcement, now)] += 1;
  return counts;
}
