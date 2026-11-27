// Customer portal header (JSM): shows the viewer's open portal announcements
// one after another. Always as a popup (flags do not exist in the portal):
// opened as a modal; where the portal does not allow one, inside the header.
import { invoke, Modal } from '@forge/bridge';
import { showPopup } from './popup.js';

export async function runPortal() {
  let items;
  try {
    ({ items } = await invoke('pending', { surface: 'portal' }));
  } catch (error) {
    console.error('SG Announcer: could not load announcements', error);
    return;
  }
  const queue = [...(items || [])];
  const root = document.getElementById('root');

  const record = (name, announcement) => invoke(name, { id: announcement.id })
    .catch(error => console.error(`SG Announcer: ${name} failed`, error));

  function inline(announcement) {
    showPopup({
      announcement,
      onAnswer: async action => { await record(action, announcement); root.replaceChildren(); next(); }
    });
  }

  function next() {
    const announcement = queue.shift();
    if (!announcement) return;
    new Modal({
      resource: 'ui',
      size: announcement.size,
      context: { announcement, fit: true },
      closeOnEscape: false,
      closeOnOverlayClick: false,
      onClose: async payload => {
        if (payload?.action === 'acknowledge' || payload?.action === 'snooze') await record(payload.action, announcement);
        next();
      }
    }).open().catch(() => inline(announcement));
  }

  next();
}
