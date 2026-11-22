/*
 * The fragment folder picker in setup: browse the environment's DAM folder by folder (click a
 * folder to open it, breadcrumb to go back up), see what a folder holds, and use any level.
 */
import el, { icon } from './ui.js';

const ROOT = '/content/dam';
const fine = (text) => el('p', { class: 'muted', text });

/** a folder the site is probably named after: `frescopa` for site `frescopa26`, `tsc` for `tsc` */
export function suggests(folderName, site) {
  const f = String(folderName || '').toLowerCase();
  const s = String(site || '').toLowerCase();
  return !!f && (f === s || (f.length >= 4 && s.startsWith(f)));
}

/** "/content/dam/a/b" → [["/content/dam", "DAM"], ["/content/dam/a", "a"], ["/content/dam/a/b", "b"]] */
export function trail(path) {
  const rest = path.slice(ROOT.length).split('/').filter(Boolean);
  return [[ROOT, 'DAM'], ...rest.map((name, i) => [`${ROOT}/${rest.slice(0, i + 1).join('/')}`, name])];
}

/** "Frescopa Product (9)" lines from fragment summaries */
function contents(items, more) {
  const counts = new Map();
  items.forEach((f) => {
    const name = f.model?.title || f.model?.name || 'Unknown model';
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  if (!counts.size) return 'No Content Fragments in this folder or its subfolders.';
  const models = [...counts].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} (${n})`).join(', ');
  return `${items.length}${more ? '+' : ''} fragments here, subfolders included: ${models}.`;
}

/**
 * @param {object} o
 * @param {object} o.broker the broker for the chosen environment (folders, list)
 * @param {string} o.start folder to open first
 * @param {string} o.site the DA site name, for the Suggested badge
 * @param {string} [o.saved] the folder in the saved setup, for the Current badge
 * @param {(path: string) => void} o.onUse
 * @returns {HTMLElement}
 */
export default function folderBrowser({
  broker, start, site, saved, onUse,
}) {
  const host = el('div', { class: 'folders' });
  let seq = 0; // the latest navigation wins when replies arrive out of order

  async function open(path) {
    seq += 1;
    const mine = seq;
    const crumbs = el('nav', { class: 'crumbs', 'aria-label': 'Folder' }, trail(path).map(([p, name], i, all) => (i === all.length - 1
      ? el('strong', { 'aria-current': 'location', text: name })
      : el('button', {
        type: 'button', class: 'crumb', text: name, onclick: () => open(p),
      }))));
    const atRoot = path === ROOT;
    const use = el('button', {
      type: 'button', class: 'nx-btn-accent', text: 'Use this folder', disabled: atRoot, onclick: () => onUse(path),
    });
    const summary = fine(atRoot ? 'Open the folder that holds this site\'s fragments.' : 'Looking at this folder…');
    const list = el('div', {}, fine('Loading folders…'));
    // el() drops null children, so the optional badge is safe inside it
    host.replaceChildren(crumbs, el('div', { class: 'actions' }, use, path === saved ? el('span', { class: 'badge', text: 'Current' }) : null), summary, list);
    crumbs.querySelector('[aria-current]')?.setAttribute('tabindex', '-1');
    crumbs.querySelector('[aria-current]')?.focus();
    if (!atRoot) {
      broker.scan(path, 1).then(({ items, more }) => {
        if (mine === seq) summary.textContent = contents(items, more);
      }).catch((e) => { if (mine === seq) summary.textContent = `Could not read this folder (${e.message}).`; });
    }
    try {
      const folders = await broker.folders(path);
      if (mine !== seq) return;
      if (!folders.length) { list.replaceChildren(fine('No subfolders.')); return; }
      const rank = (f) => [f.path === saved || (saved || '').startsWith(`${f.path}/`), suggests(f.path.split('/').pop(), site), true].indexOf(true);
      const rows = [...folders].sort((a, b) => rank(a) - rank(b)).map((f) => {
        const holdsSaved = !!saved && (f.path === saved || saved.startsWith(`${f.path}/`));
        let badge = '';
        if (holdsSaved) badge = 'Current';
        else if (suggests(f.path.split('/').pop(), site)) badge = 'Suggested';
        return el('li', {}, el(
          'button',
          {
            type: 'button', class: 'pick', 'aria-label': `Open ${f.title}`, onclick: () => open(f.path),
          },
          el('span', { class: 'pick-text' }, el('span', { class: 'pick-name' }, f.title, badge ? el('span', { class: 'badge', text: badge }) : null), el('span', { class: 'pick-meta', text: f.path })),
          icon('chevrondown'),
        ));
      });
      const ul = el('ul', { class: 'picks' }, rows);
      // long folder lists get a filter (an AEM environment can have dozens at the top)
      const filter = rows.length > 6 ? el('input', {
        id: 'folder-filter', class: 'nx-input', type: 'search', placeholder: 'Filter folders', oninput: (e) => {
          const q = e.target.value.trim().toLowerCase();
          rows.forEach((li) => { li.hidden = !!q && !li.textContent.toLowerCase().includes(q); });
        },
      }) : null;
      list.replaceChildren(...[
        el('p', { class: 'muted', text: `Subfolders (${rows.length})` }),
        filter ? el('label', { for: 'folder-filter', class: 'sr-only', text: 'Filter folders' }) : null,
        filter,
        ul,
      ].filter(Boolean));
    } catch (e) {
      if (mine === seq) list.replaceChildren(fine(`Folders could not be listed (${e.message}). Type the folder path below.`));
    }
  }

  open(start || ROOT);
  return host;
}
