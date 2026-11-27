// Stand-in for @forge/bridge, for looking at the UI outside Jira:
//   MOCK_BRIDGE=1 npx vite        then open /?role=admin (default), /?role=mine or /?role=popup
// Data lives in memory only. Never part of the production build.
const role = new URLSearchParams(location.search).get('role') || 'admin';
const PROJECTS = { SGSD: 'SG Service Desk', AS: 'App Support', SL: 'Swisslos', JRR: 'Release Reports', OPS: 'Operations' };
const GROUPS = [{ id: 'g1', name: 'jira-administrators' }, { id: 'g2', name: 'sg-agents' }, { id: 'g3', name: 'sg-developers' }];
let announcements = [{
  id: '11111111-1111-4111-8111-111111111111', rev: 1, title: 'Maintenance window on Saturday',
  body: 'Jira will be **read-only** on Saturday from 08:00 to 10:00.\n\n- Save your work before 08:00\n- Details: [status page](https://example.com/status)',
  display: 'dialog', size: 'medium', appearance: 'warning', buttonText: 'Got it', allowSnooze: true, snoozeHours: 24,
  enabled: true, startAt: null, endAt: null, groups: [GROUPS[1]], users: [], projects: ['SGSD', 'AS', 'SL'],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: 'me'
}];
const days = n => new Date(Date.now() + n * 86400000).toISOString();
announcements.push(
  { ...announcements[0], id: '22222222-2222-4222-8222-222222222222', title: 'Old release note', enabled: false, groups: [], projects: [], createdAt: days(-40), updatedAt: days(-30) },
  { ...announcements[0], id: '33333333-3333-4333-8333-333333333333', title: 'New queue layout', appearance: 'info', groups: [], projects: ['OPS'], startAt: days(3), createdAt: days(-2), updatedAt: days(-1) },
  { ...announcements[0], id: '44444444-4444-4444-8444-444444444444', title: 'Password policy change', groups: [], projects: [], createdAt: days(-10), updatedAt: days(-10) },
  { ...announcements[0], id: '55555555-5555-4555-8555-555555555555', title: 'Summer freeze', groups: [], projects: [], endAt: days(-60), createdAt: days(-90), updatedAt: days(-90) }
);
let settings = { claimedDomains: ['example.com'], hasLogo: false };
const images = {};
let columns = JSON.parse(localStorage.getItem('mock-columns') || 'null') || ['status', 'created', 'audience', 'period', 'acks'];
const handlers = {
  saveSettings: payload => {
    settings = { ...settings, claimedDomains: String(payload.settings.claimedDomains).split(/[\s,;]+/).filter(Boolean) };
    return { settings };
  },
  saveLogo: ({ dataUrl }) => { images.logo = dataUrl; settings = { ...settings, hasLogo: dataUrl != null }; return { settings }; },
  image: ({ name }) => ({ dataUrl: images[name] || null }),
  list: () => ({ announcements, columns, settings, limits: { title: 200, body: 10000, buttonText: 40, projects: 2000 } }),
  ackCounts: () => ({ counts: Object.fromEntries(announcements.map((a, i) => [a.id, i === 3 ? null : i * 17])) }),
  saveColumns: payload => { columns = payload.columns; localStorage.setItem('mock-columns', JSON.stringify(columns)); return { columns }; },
  save: ({ announcement }) => {
    const { imageData, ...rest } = announcement;
    const saved = { rev: 1, ...rest, id: announcement.id || crypto.randomUUID(), updatedAt: new Date().toISOString() };
    if (imageData) images[saved.id] = imageData;
    announcements = announcement.id ? announcements.map(a => (a.id === saved.id ? saved : a)) : [saved, ...announcements];
    return { announcement: saved };
  },
  remove: ({ id }) => { announcements = announcements.filter(a => a.id !== id); return { ok: true }; },
  resetAcknowledgements: () => ({}),
  readers: () => ({ readers: [{ accountId: 'a1', displayName: 'Jane Doe', at: new Date().toISOString() }], cursor: null }),
  users: ({ query }) => ({ users: [{ id: 'u:1', name: 'Jane Doe' }, { id: 'u:2', name: 'John Smith' }].filter(u => u.name.toLowerCase().includes(query.toLowerCase())) }),
  groups: ({ query }) => ({ groups: GROUPS.filter(g => g.name.includes(query.toLowerCase())) }),
  checkProjects: ({ keys }) => ({ found: keys.filter(k => PROJECTS[k]).map(key => ({ key, name: PROJECTS[key] })), unknown: keys.filter(k => !PROJECTS[k]) }),
  pending: () => ({ items: announcements }),
  mine: () => ({ items: announcements.slice(0, 3).map((a, i) => ({ id: a.id, title: a.title, body: a.body, size: a.size, appearance: a.appearance, confirmedAt: days(-i * 9), changed: i === 1 })) })
};
export const invoke = async (name, payload = {}) => structuredClone(handlers[name](payload));
export const view = {
  getContext: async () => ({
    extension: role === 'popup'
      ? { modal: JSON.parse(sessionStorage.getItem('mock-modal') || 'null') || { announcement: announcements[0], preview: true } }
      : { type: role === 'mine' ? 'jira:globalPage' : 'jira:adminPage' }
  }),
  theme: { enable: async () => {} },
  close: payload => window.parent.postMessage({ mockClose: payload || null }, '*')
};
export const router = { open: url => window.open(url, '_blank') };
export const showFlag = options => { console.log('flag', options); return { close: () => {} }; };
export class Modal {
  constructor(options) { this.options = options; }
  async open() {
    sessionStorage.setItem('mock-modal', JSON.stringify(this.options.context));
    const width = { small: 400, medium: 600, large: 800 }[this.options.size] || 600;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(9,30,66,.5);display:flex;align-items:center;justify-content:center;z-index:99';
    overlay.innerHTML = `<iframe src="?role=popup" style="width:${width}px;height:420px;border:0;border-radius:8px;background:#fff"></iframe>`;
    document.body.appendChild(overlay);
    window.addEventListener('message', event => { if ('mockClose' in (event.data || {})) { overlay.remove(); this.options.onClose?.(event.data.mockClose); } }, { once: true });
  }
}
