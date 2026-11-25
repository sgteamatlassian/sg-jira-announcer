// The popup itself. It only reports the viewer's answer back through
// view.close(); the opener (background script) records it.
import { view, router } from '@forge/bridge';
import { renderRichText } from './richtext.mjs';
import './styles.css';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function showPopup({ announcement, preview = false }) {
  view.theme.enable().catch(() => {});
  const root = document.getElementById('root');
  const popup = element('div', `popup popup-${announcement.appearance}`);

  const header = element('header', 'popup-header');
  header.append(element('span', 'popup-icon'), element('h1', null, announcement.title));
  popup.append(header);

  const body = element('div', 'popup-body richtext');
  renderRichText(body, announcement.body, href => router.open(href));
  popup.append(body);

  const footer = element('footer', 'popup-footer');
  if (preview) footer.append(element('span', 'muted popup-note', 'Preview – nothing is recorded.'));
  if (announcement.allowSnooze) {
    const later = element('button', 'subtle', 'Remind me later');
    later.addEventListener('click', () => view.close({ action: preview ? 'preview' : 'snooze' }));
    footer.append(later);
  }
  const confirm = element('button', 'primary', announcement.buttonText);
  confirm.addEventListener('click', () => view.close({ action: preview ? 'preview' : 'acknowledge' }));
  footer.append(confirm);
  popup.append(footer);

  root.replaceChildren(popup);
  confirm.focus();
}
