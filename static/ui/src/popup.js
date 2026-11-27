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

// `closeOnly` + `note`: a read-only view ("My announcements") with one Close button.
// `onAnswer`: shown inside the page instead of a modal (customer portal); the
// answer goes to this callback instead of view.close().
// `fit`: as tall as the text instead of the frame (modals in the customer portal).
export function showPopup({ announcement, preview = false, closeOnly = false, note = '', onAnswer = null, fit = false }) {
  view.theme.enable().catch(() => {});
  const root = document.getElementById('root');
  const popup = element('div', `popup popup-${announcement.appearance}${onAnswer ? ' popup-inline' : ''}${fit || onAnswer ? ' popup-fit' : ''}`);

  const header = element('header', 'popup-header');
  header.append(element('span', 'popup-icon'), element('h1', null, announcement.title));
  popup.append(header);

  const body = element('div', 'popup-body richtext');
  renderRichText(body, announcement.body, href => router.open(href));
  popup.append(body);

  const footer = element('footer', 'popup-footer');
  if (closeOnly) {
    if (note) footer.append(element('span', 'muted popup-note', note));
    const close = element('button', 'primary', 'Close');
    close.addEventListener('click', () => view.close({ action: 'close' }));
    footer.append(close);
    popup.append(footer);
    root.replaceChildren(popup);
    close.focus();
    return;
  }
  if (preview) footer.append(element('span', 'muted popup-note', 'Preview – nothing is recorded.'));
  if (announcement.allowSnooze) {
    const later = element('button', 'subtle', 'Remind me later');
    later.addEventListener('click', () => (onAnswer ? onAnswer('snooze') : view.close({ action: preview ? 'preview' : 'snooze' })));
    footer.append(later);
  }
  const confirm = element('button', 'primary', announcement.buttonText);
  confirm.addEventListener('click', () => (onAnswer ? onAnswer('acknowledge') : view.close({ action: preview ? 'preview' : 'acknowledge' })));
  footer.append(confirm);
  popup.append(footer);

  root.replaceChildren(popup);
  confirm.focus();
}
