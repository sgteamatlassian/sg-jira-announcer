// Background script: asks once per page load which announcements the viewer
// still has to see and shows them one after another.
import { invoke, view, Modal, showFlag } from '@forge/bridge';
import { projectKeyFromContext, matchesProject } from './targeting.mjs';
import { toPlainText } from './richtext.mjs';

// Jira is a single-page app: the script can outlive a change of project, so the
// open project is re-read from the context at this interval.
const RECHECK_MS = 5000;

export async function runBackground() {
  let items;
  try {
    ({ items } = await invoke('pending'));
  } catch (error) {
    console.error('SG Announcer: could not load announcements', error);
    return;
  }
  if (!items?.length) return;

  const handled = new Set();
  let showing = false;

  const record = (name, announcement) => invoke(name, { id: announcement.id })
    .catch(error => console.error(`SG Announcer: ${name} failed`, error));

  function showDialog(announcement) {
    showing = true;
    new Modal({
      resource: 'ui',
      size: announcement.size,
      context: { announcement },
      closeOnEscape: false,
      closeOnOverlayClick: false,
      onClose: async payload => {
        if (payload?.action === 'acknowledge') await record('acknowledge', announcement);
        else if (payload?.action === 'snooze') await record('snooze', announcement);
        showing = false;
        next();
      }
    }).open().catch(error => {
      console.error('SG Announcer: could not open the popup', error);
      showing = false;
    });
  }

  function showAsFlag(announcement) {
    const flag = showFlag({
      id: `sg-announcer-${announcement.id}`,
      title: announcement.title,
      description: toPlainText(announcement.body),
      type: announcement.appearance,
      isAutoDismiss: false,
      actions: [{
        text: announcement.buttonText,
        onClick: () => { record('acknowledge', announcement); flag.close(); }
      }]
    });
  }

  async function next() {
    if (showing) return;
    let projectKey = null;
    try { projectKey = projectKeyFromContext((await view.getContext()).extension); } catch { /* keep null */ }
    for (const announcement of items) {
      if (handled.has(announcement.id) || !matchesProject(announcement, projectKey)) continue;
      // Shown at most once per page load, also when closed without an answer.
      handled.add(announcement.id);
      if (announcement.display === 'flag') { showAsFlag(announcement); continue; }
      showDialog(announcement);
      return;
    }
  }

  await next();
  if (items.some(announcement => announcement.projects?.length)) setInterval(next, RECHECK_MS);
}
