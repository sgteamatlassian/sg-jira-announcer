// One bundle serves three roles; the Forge context says which one this frame is:
//   - the invisible background script on every Jira page
//   - the popup (a modal opened by the background script, or the admin preview)
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
} else {
  const { showAdmin } = await import('./admin.jsx');
  showAdmin();
}
