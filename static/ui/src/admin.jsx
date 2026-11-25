import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, view, Modal } from '@forge/bridge';
import { parseProjectKeysCsv } from './csv.mjs';
import { BodyEditor } from './editor.jsx';
import { STATUSES, SORTS, filterAndSort, countByStatus } from './overview.mjs';
import './styles.css';

const EMPTY = {
  title: '', body: '', display: 'dialog', size: 'medium', appearance: 'info', buttonText: 'Got it',
  allowSnooze: false, snoozeHours: 24, enabled: false, startAt: null, endAt: null, groups: [], projects: []
};
const CHIP_PREVIEW = 60;

const formatDate = value => (value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
const pad = number => String(number).padStart(2, '0');
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = value => (value ? new Date(value).toISOString() : null);
const message = error => error?.message || String(error);

function audience(announcement) {
  const who = announcement.groups.length ? `Members of ${announcement.groups.map(group => group.name).join(', ')}` : 'Everyone';
  const count = announcement.projects.length;
  const where = !count ? 'on every Jira page'
    : count <= 4 ? `inside ${announcement.projects.join(', ')}`
      : `inside ${count} projects (${announcement.projects.slice(0, 3).join(', ')}, …)`;
  return `${who} · ${where}`;
}

// ---- Projects: chips, manual entry and the CSV import -----------------------

async function checkInJira(keys, onProgress) {
  const names = {};
  const unknown = [];
  for (let start = 0; start < keys.length; start += 50) {
    onProgress(start, keys.length);
    const result = await invoke('checkProjects', { keys: keys.slice(start, start + 50) });
    for (const project of result.found) names[project.key] = project.name;
    unknown.push(...result.unknown);
  }
  return { names, unknown };
}

function ProjectsField({ projects, onChange, limit }) {
  const fileInput = useRef(null);
  const [entry, setEntry] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [skipUnknown, setSkipUnknown] = useState(true);
  const [error, setError] = useState('');

  async function importText(text, source) {
    setError(''); setResult(null);
    const parsed = parseProjectKeysCsv(text);
    if (!parsed.keys.length) {
      setError(`No project keys found in ${source}.${parsed.invalid.length ? ` Not valid as a key: ${parsed.invalid.slice(0, 5).join(', ')}` : ''}`);
      return;
    }
    try {
      const checked = await checkInJira(parsed.keys, (done, total) => setProgress({ done, total }));
      setResult({ ...parsed, ...checked, source });
    } catch (failure) {
      setError(`The keys could not be checked in Jira: ${message(failure)}`);
    } finally {
      setProgress(null);
    }
  }

  async function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError('The file is larger than 2 MB.'); return; }
    await importText(await file.text(), file.name);
  }

  function apply(replace) {
    const incoming = skipUnknown ? result.keys.filter(key => !result.unknown.includes(key)) : result.keys;
    const merged = replace ? incoming : [...projects, ...incoming.filter(key => !projects.includes(key))];
    if (merged.length > limit) { setError(`At most ${limit} projects per announcement (this would be ${merged.length}).`); return; }
    onChange(merged);
    setResult(null);
  }

  // Typed or pasted keys take the same route as a file: parsed, checked in
  // Jira and offered for confirmation.
  async function addEntry() {
    if (!entry.trim()) return;
    await importText(entry.trim().replace(/[\s,;]+/g, ','), 'your entry');
    setEntry('');
  }

  const visible = showAll ? projects : projects.slice(0, CHIP_PREVIEW);
  const importable = result ? (skipUnknown ? result.keys.length - result.unknown.length : result.keys.length) : 0;

  return (
    <div className="projects-field">
      <div className="row">
        <input type="file" ref={fileInput} accept=".csv,.txt,text/csv,text/plain" hidden onChange={onFile} />
        <button type="button" className="primary" disabled={!!progress} onClick={() => fileInput.current.click()}>Import project keys from CSV…</button>
        <input value={entry} placeholder="or type / paste keys, e.g. SGSD, AS" onChange={event => setEntry(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addEntry(); } }} />
        <button type="button" onClick={addEntry} disabled={!entry.trim() || !!progress}>Check &amp; add</button>
        {projects.length > 0 && <button type="button" className="subtle" onClick={() => onChange([])}>Remove all</button>}
      </div>
      <p className="muted">CSV: one project key per line, or a table with a column named “Key” / “Project key” (otherwise the first column is used). Comma, semicolon or tab separated.</p>

      {progress && <p className="muted">Checking keys in Jira… {progress.done} / {progress.total}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {result && (
        <div className="import-result">
          <strong>{result.keys.length} project key{result.keys.length === 1 ? '' : 's'} read from {result.source}</strong>
          {result.column && <span className="muted"> (column: {result.column})</span>}
          <ul>
            <li>{result.keys.length - result.unknown.length} found in Jira</li>
            {result.unknown.length > 0 && <li className="warn">{result.unknown.length} not found in Jira (or not visible to you): {result.unknown.join(', ')}</li>}
            {result.duplicates > 0 && <li>{result.duplicates} duplicate{result.duplicates === 1 ? '' : 's'} ignored</li>}
            {result.invalid.length > 0 && <li className="warn">{result.invalid.length} cell{result.invalid.length === 1 ? '' : 's'} ignored, not a project key: {result.invalid.slice(0, 10).join(', ')}{result.invalid.length > 10 ? ', …' : ''}</li>}
          </ul>
          {result.unknown.length > 0 && (
            <label className="check"><input type="checkbox" checked={skipUnknown} onChange={event => setSkipUnknown(event.target.checked)} /> Skip the keys that were not found</label>
          )}
          <div className="row">
            <button type="button" className="primary" disabled={!importable} onClick={() => apply(false)}>Add {importable} to the list</button>
            {projects.length > 0 && <button type="button" disabled={!importable} onClick={() => apply(true)}>Replace the list</button>}
            <button type="button" className="subtle" onClick={() => setResult(null)}>Cancel</button>
          </div>
        </div>
      )}

      {projects.length === 0
        ? <p className="muted">No projects selected – the announcement appears on every Jira page.</p>
        : (
          <>
            <p><strong>{projects.length}</strong> project{projects.length === 1 ? '' : 's'} – the announcement appears only inside {projects.length === 1 ? 'this project' : 'these projects'}.</p>
            <div className="chips">
              {visible.map(key => (
                <span className="chip" key={key}>{key}
                  <button type="button" aria-label={`Remove ${key}`} onClick={() => onChange(projects.filter(other => other !== key))}>×</button>
                </span>
              ))}
              {projects.length > CHIP_PREVIEW && (
                <button type="button" className="link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${projects.length}`}</button>
              )}
            </div>
          </>
        )}
    </div>
  );
}

// ---- Groups -----------------------------------------------------------------

function GroupsField({ groups, onChange }) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!query.trim()) { setMatches(null); return undefined; }
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const result = await invoke('groups', { query });
        if (!stale) { setMatches(result.groups); setError(''); }
      } catch (failure) { if (!stale) setError(message(failure)); }
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [query]);
  const available = (matches || []).filter(group => !groups.some(chosen => chosen.id === group.id));
  return (
    <div>
      <input value={query} placeholder="Search groups…" onChange={event => setQuery(event.target.value)} />
      {error && <p className="error">{error}</p>}
      {matches && (
        <div className="matches">
          {available.length === 0 ? <span className="muted">No further groups found.</span> : available.map(group => (
            <button type="button" key={group.id} onClick={() => { onChange([...groups, group]); setQuery(''); }}>+ {group.name}</button>
          ))}
        </div>
      )}
      {groups.length === 0
        ? <p className="muted">No groups selected – everyone gets the announcement.</p>
        : (
          <div className="chips">
            {groups.map(group => (
              <span className="chip" key={group.id}>{group.name}
                <button type="button" aria-label={`Remove ${group.name}`} onClick={() => onChange(groups.filter(other => other.id !== group.id))}>×</button>
              </span>
            ))}
          </div>
        )}
    </div>
  );
}

// ---- Editor -----------------------------------------------------------------

function Editor({ initial, limits, onSaved, onCancel }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = patch => setForm(previous => ({ ...previous, ...patch }));

  async function save() {
    setBusy(true); setError('');
    try {
      const result = await invoke('save', { announcement: form });
      onSaved(result.announcement);
    } catch (failure) { setError(message(failure)); setBusy(false); }
  }

  function preview() {
    new Modal({ resource: 'ui', size: form.size, context: { announcement: { ...form, title: form.title || 'Title', buttonText: form.buttonText || 'Got it' }, preview: true } }).open();
  }

  return (
    <form onSubmit={event => { event.preventDefault(); save(); }}>
      <div className="section-title">
        <h2>{form.id ? 'Edit announcement' : 'New announcement'}</h2>
        <div className="row">
          <button type="button" className="subtle" onClick={onCancel}>Cancel</button>
          {form.display === 'dialog' && <button type="button" onClick={preview}>Preview popup</button>}
          <button type="submit" className="primary" disabled={busy || !form.title.trim() || form.body.length > limits.body}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <section>
        <h3>Message</h3>
        <label className="field">Title
          <input value={form.title} maxLength={limits.title} onChange={event => set({ title: event.target.value })} />
        </label>
        <div className="field">Text
          <BodyEditor value={form.body} maxLength={limits.body} onChange={body => set({ body })} />
        </div>
      </section>

      <section>
        <h3>Who gets it</h3>
        <p className="muted">Both conditions apply together: the person must be in one of the groups <em>and</em> be inside one of the projects.</p>
        <h4>Projects</h4>
        <ProjectsField projects={form.projects} limit={limits.projects} onChange={projects => set({ projects })} />
        <h4>Groups</h4>
        <GroupsField groups={form.groups} onChange={groups => set({ groups })} />
      </section>

      <section>
        <h3>How and when</h3>
        <div className="grid">
          <label className="field">Shown as
            <select value={form.display} onChange={event => set({ display: event.target.value })}>
              <option value="dialog">Popup (dialog)</option>
              <option value="flag">Flag (bottom-left notice)</option>
            </select>
          </label>
          {form.display === 'dialog' && (
            <label className="field">Popup size
              <select value={form.size} onChange={event => set({ size: event.target.value })}>
                <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option>
              </select>
            </label>
          )}
          <label className="field">Kind
            <select value={form.appearance} onChange={event => set({ appearance: event.target.value })}>
              <option value="info">Information</option><option value="success">Success</option>
              <option value="warning">Warning</option><option value="error">Critical</option>
            </select>
          </label>
          <label className="field">Confirm button
            <input value={form.buttonText} maxLength={limits.buttonText} onChange={event => set({ buttonText: event.target.value })} />
          </label>
          <label className="field">Show from (optional)
            <input type="datetime-local" value={toLocalInput(form.startAt)} onChange={event => set({ startAt: fromLocalInput(event.target.value) })} />
          </label>
          <label className="field">Show until (optional)
            <input type="datetime-local" value={toLocalInput(form.endAt)} onChange={event => set({ endAt: fromLocalInput(event.target.value) })} />
          </label>
        </div>
        {form.display === 'dialog' && (
          <label className="check">
            <input type="checkbox" checked={form.allowSnooze} onChange={event => set({ allowSnooze: event.target.checked })} />
            <span>Offer “Remind me later” – ask again after{' '}
              <input type="number" className="hours" min={1} max={720} value={form.snoozeHours} disabled={!form.allowSnooze}
                onChange={event => set({ snoozeHours: event.target.value })} /> hours</span>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={form.enabled} onChange={event => set({ enabled: event.target.checked })} />
          <span><strong>Enabled</strong> – each person sees the announcement until they confirm it.</span>
        </label>
      </section>
    </form>
  );
}

// ---- Who has read it --------------------------------------------------------

function Readers({ announcement, onBack }) {
  const [readers, setReaders] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(from, all = false) {
    setLoading(true); setError('');
    try {
      let next = from;
      const loaded = [];
      do {
        const page = await invoke('readers', { id: announcement.id, cursor: next });
        loaded.push(...page.readers);
        next = page.cursor;
      } while (all && next);
      setReaders(previous => [...(from ? previous : []), ...loaded]);
      setCursor(next);
      return loaded;
    } catch (failure) { setError(message(failure)); return []; } finally { setLoading(false); }
  }
  useEffect(() => { load(null); }, []);

  async function exportCsv() {
    const rest = cursor ? await load(cursor, true) : [];
    const quote = value => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [...readers, ...rest].map(reader => [reader.displayName, reader.accountId, reader.at].map(quote).join(';'));
    const blob = new Blob([`﻿Name;Account ID;Confirmed at\n${rows.join('\n')}\n`], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'announcement-readers.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <>
      <div className="section-title">
        <h2>Confirmed by – {announcement.title}</h2>
        <div className="row">
          <button type="button" className="subtle" onClick={onBack}>Back</button>
          <button type="button" disabled={loading || !readers.length} onClick={exportCsv}>Export CSV</button>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <section>
        {readers.length === 0 && !loading ? <p className="muted">Nobody has confirmed this announcement yet.</p> : (
          <table>
            <thead><tr><th>Person</th><th>Confirmed at</th></tr></thead>
            <tbody>{readers.map(reader => <tr key={reader.accountId}><td>{reader.displayName}</td><td>{formatDate(reader.at)}</td></tr>)}</tbody>
          </table>
        )}
        <p className="muted">{loading ? 'Loading…' : `${readers.length}${cursor ? '+' : ''} confirmation${readers.length === 1 ? '' : 's'}`}</p>
        {cursor && !loading && <button type="button" onClick={() => load(cursor)}>Load more</button>}
      </section>
    </>
  );
}

// ---- Popover: the row menu and the column chooser ----------------------------

// A button that opens a small panel. Closes on outside click and Escape; opens
// upwards when there is no room below (the page lives in a sized iframe).
function Popover({ label, title, className = '', children }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const root = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = event => { if (!root.current.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { setOpen(false); root.current.querySelector('button').focus(); } };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  function toggle() {
    if (!open) {
      const box = root.current.getBoundingClientRect();
      const below = document.documentElement.clientHeight - box.bottom;
      setUp(below < 240 && box.top > below);
    }
    setOpen(!open);
  }
  return (
    <span className={`popover ${className}`} ref={root}>
      <button type="button" className="popover-button" aria-haspopup="true" aria-expanded={open} aria-label={title} title={title} onClick={toggle}>{label}</button>
      {open && <div className={`popover-panel${up ? ' up' : ''}`}>{typeof children === 'function' ? children(() => setOpen(false)) : children}</div>}
    </span>
  );
}

const COLUMNS = [
  { id: 'status', label: 'Status' },
  { id: 'created', label: 'Created' },
  { id: 'updated', label: 'Changed' },
  { id: 'audience', label: 'Who gets it' },
  { id: 'period', label: 'Period' }
];

// ---- Page -------------------------------------------------------------------

function App() {
  const [announcements, setAnnouncements] = useState(null);
  const [limits, setLimits] = useState(null);
  const [screen, setScreen] = useState({ name: 'list' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState({ status: 'all', search: '', sort: 'active' });
  const [columns, setColumns] = useState(COLUMNS.map(column => column.id));

  async function refresh() {
    try {
      const result = await invoke('list');
      setAnnouncements(result.announcements); setLimits(result.limits); setColumns(result.columns); setError('');
    } catch (failure) { setError(message(failure)); }
  }
  useEffect(() => { refresh(); }, []);

  async function act(name, announcement, done) {
    setError(''); setNotice('');
    try { await invoke(name, { id: announcement.id }); setNotice(done); await refresh(); } catch (failure) { setError(message(failure)); }
  }
  // Shown at once, saved for this administrator in the background.
  function toggleColumn(id) {
    const next = columns.includes(id) ? columns.filter(other => other !== id) : [...columns, id];
    setColumns(next);
    invoke('saveColumns', { columns: next }).catch(failure => setError(`The column selection could not be saved: ${message(failure)}`));
  }
  async function toggle(announcement) {
    setError(''); setNotice('');
    try { await invoke('save', { announcement: { ...announcement, enabled: !announcement.enabled } }); await refresh(); } catch (failure) { setError(message(failure)); }
  }

  if (screen.name === 'edit') {
    return (
      <main>
        <Editor initial={screen.announcement} limits={limits} onCancel={() => setScreen({ name: 'list' })}
          onSaved={async saved => { setNotice(`“${saved.title}” saved.`); setScreen({ name: 'list' }); await refresh(); }} />
      </main>
    );
  }
  if (screen.name === 'readers') {
    return <main><Readers announcement={screen.announcement} onBack={() => setScreen({ name: 'list' })} /></main>;
  }

  return (
    <main>
      <div className="section-title">
        <div>
          <h1>SG Announcer</h1>
          <p className="muted">Announcements that pop up for Jira users until they confirm them.</p>
        </div>
        <button type="button" className="primary" disabled={!limits} onClick={() => { setNotice(''); setScreen({ name: 'edit', announcement: EMPTY }); }}>New announcement</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      <section>
        {announcements == null ? (!error && <p className="muted">Loading…</p>)
          : announcements.length === 0 ? <p className="muted">No announcements yet.</p> : (() => {
            const counts = countByStatus(announcements);
            const rows = filterAndSort(announcements, filter);
            return (
              <>
                <div className="filters">
                  <input type="search" value={filter.search} placeholder="Search title, text, project key or group…" aria-label="Search announcements"
                    onChange={event => setFilter({ ...filter, search: event.target.value })} />
                  <div className="status-filter" role="group" aria-label="Filter by status">
                    {[{ id: 'all', label: 'All' }, ...STATUSES].map(option => (
                      <button type="button" key={option.id} aria-pressed={filter.status === option.id} className={filter.status === option.id ? 'on' : ''}
                        onClick={() => setFilter({ ...filter, status: option.id })}>{option.label} <span className="count">{counts[option.id]}</span></button>
                    ))}
                  </div>
                  <label className="sort">Sort
                    <select value={filter.sort} onChange={event => setFilter({ ...filter, sort: event.target.value })}>
                      {SORTS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <Popover className="columns-chooser" title="Show or hide columns" label="Columns">
                    <div className="menu-title">Columns</div>
                    {COLUMNS.map(column => (
                      <label className="menu-check" key={column.id}>
                        <input type="checkbox" checked={columns.includes(column.id)} onChange={() => toggleColumn(column.id)} /> {column.label}
                      </label>
                    ))}
                  </Popover>
                </div>
                {rows.length === 0 ? (
                  <p className="muted">No announcement matches the filter. <button type="button" className="link" onClick={() => setFilter({ status: 'all', search: '', sort: filter.sort })}>Clear filter</button></p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Announcement</th>
                        {COLUMNS.filter(column => columns.includes(column.id)).map(column => <th key={column.id}>{column.label}</th>)}
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ announcement, status }) => {
                        const { label, tone } = STATUSES.find(option => option.id === status);
                        const cells = {
                          status: <td key="status"><span className={`lozenge ${tone}`}>{label}</span></td>,
                          created: <td key="created" className="nowrap">{formatDate(announcement.createdAt)}</td>,
                          updated: <td key="updated" className="nowrap">{formatDate(announcement.updatedAt)}</td>,
                          audience: <td key="audience">{audience(announcement)}</td>,
                          period: <td key="period">{announcement.startAt || announcement.endAt ? `${formatDate(announcement.startAt)} → ${formatDate(announcement.endAt)}` : 'No limit'}</td>
                        };
                        return (
                          <tr key={announcement.id}>
                            <td><strong>{announcement.title}</strong><br /><span className="muted">{announcement.display === 'flag' ? 'Flag' : 'Popup'}</span></td>
                            {COLUMNS.filter(column => columns.includes(column.id)).map(column => cells[column.id])}
                            <td className="row-menu">
                              <Popover className="right" title={`Actions for ${announcement.title}`} label="⋯">
                                {close => {
                                  const item = (text, action, className = '') => (
                                    <button type="button" role="menuitem" className={`menu-item ${className}`} onClick={() => { close(); action(); }}>{text}</button>
                                  );
                                  return (
                                    <div role="menu">
                                      {item('Edit', () => { setNotice(''); setScreen({ name: 'edit', announcement }); })}
                                      {item(announcement.enabled ? 'Disable' : 'Enable', () => toggle(announcement))}
                                      {item('Confirmed by', () => setScreen({ name: 'readers', announcement }))}
                                      {item('Show again to everyone', () => { if (window.confirm(`Show “${announcement.title}” again to everyone who has already confirmed it?`)) act('resetAcknowledgements', announcement, 'The announcement is shown to everyone again.'); })}
                                      <div className="menu-divider" />
                                      {item('Delete', () => { if (window.confirm(`Delete “${announcement.title}” and its confirmations? This cannot be undone.`)) act('remove', announcement, 'Announcement deleted.'); }, 'danger')}
                                    </div>
                                  );
                                }}
                              </Popover>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <p className="muted">{rows.length} of {announcements.length} announcement{announcements.length === 1 ? '' : 's'}</p>
              </>
            );
          })()}
      </section>
    </main>
  );
}

export function showAdmin() {
  view.theme.enable().catch(() => {});
  createRoot(document.getElementById('root')).render(<App />);
}
