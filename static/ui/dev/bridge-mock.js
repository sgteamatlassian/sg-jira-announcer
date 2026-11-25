// Stand-in for @forge/bridge, for looking at the UI outside Jira:
//   MOCK_BRIDGE=1 npx vite        then open /?role=admin (default) or /?role=popup
// Data lives in memory only. Never part of the production build.
const role = new URLSearchParams(location.search).get('role') || 'admin';
const PROJECTS = { SGSD: 'SG Service Desk', AS: 'App Support', SL: 'Swisslos', JRR: 'Release Reports', OPS: 'Operations' };
const GROUPS = [{ id: 'g1', name: 'jira-administrators' }, { id: 'g2', name: 'sg-agents' }, { id: 'g3', name: 'sg-developers' }];
let announcements = [{
  id: '11111111-1111-4111-8111-111111111111', rev: 1, title: 'Maintenance window on Saturday',
  body: 'Jira will be **read-only** on Saturday from 08:00 to 10:00.\n\n- Save your work before 08:00\n- Details: [status page](https://example.com/status)',
  display: 'dialog', size: 'medium', appearance: 'warning', buttonText: 'Got it', allowSnooze: true, snoozeHours: 24,
  enabled: true, startAt: null, endAt: null, groups: [GROUPS[1]], projects: ['SGSD', 'AS', 'SL'],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: 'me'
}];
const handlers = {
  list: () => ({ announcements, limits: { title: 200, body: 10000, buttonText: 40, projects: 2000 } }),
  save: ({ announcement }) => {
    const saved = { rev: 1, ...announcement, id: announcement.id || crypto.randomUUID(), updatedAt: new Date().toISOString() };
    announcements = announcement.id ? announcements.map(a => (a.id === saved.id ? saved : a)) : [saved, ...announcements];
    return { announcement: saved };
  },
  remove: ({ id }) => { announcements = announcements.filter(a => a.id !== id); return { ok: true }; },
  resetAcknowledgements: () => ({}),
  readers: () => ({ readers: [{ accountId: 'a1', displayName: 'Jane Doe', at: new Date().toISOString() }], cursor: null }),
  groups: ({ query }) => ({ groups: GROUPS.filter(g => g.name.includes(query.toLowerCase())) }),
  checkProjects: ({ keys }) => ({ found: keys.filter(k => PROJECTS[k]).map(key => ({ key, name: PROJECTS[key] })), unknown: keys.filter(k => !PROJECTS[k]) }),
  pending: () => ({ items: announcements })
};
export const invoke = async (name, payload = {}) => structuredClone(handlers[name](payload));
export const view = {
  getContext: async () => ({
    extension: role === 'popup'
      ? { modal: JSON.parse(sessionStorage.getItem('mock-modal') || 'null') || { announcement: announcements[0], preview: true } }
      : { type: 'jira:adminPage' }
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
