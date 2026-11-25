// "My announcements": every user's own list of the announcements they have
// confirmed, to read them again.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, view, Modal } from '@forge/bridge';
import { toPlainText } from './richtext.mjs';
import './styles.css';

const formatDate = value => (value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '–');

function Mine() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    invoke('mine').then(result => setItems(result.items)).catch(failure => setError(failure?.message || String(failure)));
  }, []);

  function open(item) {
    new Modal({
      resource: 'ui', size: item.size,
      context: { announcement: item, closeOnly: true, note: `You confirmed this on ${formatDate(item.confirmedAt)}.` }
    }).open();
  }

  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const visible = (items || []).filter(item => words.every(word => `${item.title}\n${item.body}`.toLowerCase().includes(word)));

  return (
    <main>
      <h1>My announcements</h1>
      <p className="muted">The announcements you have confirmed. Click one to read it again.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <section>
        {items == null ? (!error && <p className="muted">Loading…</p>)
          : items.length === 0 ? <p className="muted">You have not confirmed any announcement yet.</p> : (
            <>
              <div className="filters">
                <input type="search" value={search} placeholder="Search title or text…" aria-label="Search my announcements" onChange={event => setSearch(event.target.value)} />
              </div>
              {visible.length === 0 ? <p className="muted">No announcement matches the search.</p> : (
                <table>
                  <thead><tr><th>Announcement</th><th>Confirmed</th></tr></thead>
                  <tbody>
                    {visible.map(item => {
                      const excerpt = toPlainText(item.body).replace(/\s+/g, ' ');
                      return (
                        <tr key={item.id} className="clickable" tabIndex={0} title="Read again" onClick={() => open(item)}
                          onKeyDown={event => { if (event.key === 'Enter') open(item); }}>
                          <td>
                            <strong>{item.title}</strong>
                            {item.changed && <span className="lozenge info changed-note" title="This announcement was shown to everyone again after you confirmed it.">Shown again since</span>}
                            <br /><span className="muted">{excerpt.length > 140 ? `${excerpt.slice(0, 140)}…` : excerpt}</span>
                          </td>
                          <td className="nowrap">{formatDate(item.confirmedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <p className="muted">{visible.length} of {items.length} announcement{items.length === 1 ? '' : 's'}</p>
            </>
          )}
      </section>
    </main>
  );
}

export function showMine() {
  view.theme.enable().catch(() => {});
  createRoot(document.getElementById('root')).render(<Mine />);
}
