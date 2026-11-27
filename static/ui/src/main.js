// One bundle serves four roles; the Forge context says which one this frame is:
//   - the invisible background script on every Jira page
//   - the customer portal header (JSM): mandatory announcements
//   - the popup (a modal opened by the background script, or the admin preview)
//   - "My announcements", the page every user has in the Apps menu
//   - the admin page
// Each role is loaded on demand so the background script stays small.
import { view } from '@forge/bridge';

const context = await view.getContext();
const extension = context.extension || {};

if (extension.modal) {
  const { showPopup } = await import('./popup.js');
  showPopup(extension.modal);
} else if (extension.type === 'jira:globalBackgroundScript') {
  const { runBackground } = await import('./background.js');
  runBackground();
} else if (extension.type === 'jiraServiceManagement:portalHeader') {
  const { runPortal } = await import('./portal.js');
  runPortal();
} else if (extension.type === 'jira:globalPage') {
  const { showMine } = await import('./mine.jsx');
  showMine();
} else {
  const { showAdmin } = await import('./admin.jsx');
  showAdmin();
}
