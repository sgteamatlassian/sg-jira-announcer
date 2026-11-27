// The popup itself. It only reports the viewer's answer back through
// view.close(); the opener (background script) records it.
import { view, router, invoke } from '@forge/bridge';
import { renderRichText } from './richtext.mjs';
import './styles.css';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Links open through Jira (new tab). Email links go to the mail program; if
// Jira refuses to open them, the browser is asked directly.
function openLink(href) {
  const fallback = () => { window.open(href, '_blank', 'noopener'); };
  try {
    Promise.resolve(router.open(href)).catch(fallback);
  } catch { fallback(); }
}

// The picture is loaded after the popup is shown, so the text never waits for
// it; a picture that cannot be loaded is simply left out. The admin preview
// passes an unsaved picture as `imageData`.
function addPicture(announcement, header, body) {
  const image = announcement.image || 'none';
  if (image === 'none') return;
  const name = image === 'logo' ? 'logo' : announcement.id;
  const source = image === 'custom' && announcement.imageData
    ? Promise.resolve(announcement.imageData)
    : name ? invoke('image', { name }).then(result => result?.dataUrl) : Promise.resolve(null);
  source.then(dataUrl => {
    if (!dataUrl) return;
    const picture = element('img', image === 'logo' ? 'popup-logo' : 'popup-picture');
    picture.src = dataUrl;
    picture.alt = '';
    if (image === 'logo') header.prepend(picture); else body.prepend(picture);
  }).catch(error => console.error('SG Announcer: could not load the picture', error));
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
  renderRichText(body, announcement.body, openLink);
  popup.append(body);
  addPicture(announcement, header, body);

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
