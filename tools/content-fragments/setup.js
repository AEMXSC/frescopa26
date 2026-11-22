/*
 * Setup wizard: the first person to open the panel on a site connects it, without editing
 * config sheets. 1. pick an AEM author (from the user's environments); 2. pick the content
 * folder; 3. review the models found there, each with a starter template (previewed on a real
 * fragment, editable), and save. Saving writes the site's DA config (sheets `content-fragments`,
 * `content-fragment-models`, and the two library entries); DA lets only config editors do it.
 */
import el, { icon } from './ui.js';
import { listAuthors } from './discovery.js';
import { starterTemplate } from './starter.js';
import { render, fragmentData } from '../../scripts/cf-render.js';

const sheet = (rows) => ({
  total: rows.length, limit: rows.length, offset: 0, data: rows,
});

/** the site config with this setup merged in; every other sheet and row is kept */
export function mergeConfig(raw, { settings, models, panelPath }) {
  const out = structuredClone(raw && raw[':names'] ? raw : { ':names': [], ':version': 3, ':type': 'multi-sheet' });
  const names = new Set(out[':names']);
  const upsert = (name, rows, keyOf) => {
    const current = out[name]?.data || [];
    const byKey = new Map(current.map((r) => [keyOf(r), r]));
    rows.forEach((r) => byKey.set(keyOf(r), { ...byKey.get(keyOf(r)), ...r }));
    out[name] = { ...out[name], ...sheet([...byKey.values()]) };
    names.add(name);
  };
  upsert('content-fragments', Object.entries(settings).filter(([, v]) => v !== undefined)
    .map(([key, value]) => ({ key, value: String(value) })), (r) => r.key);
  upsert('content-fragment-models', models.map((m) => ({
    model: m.model, label: m.label || '', template: m.template || '', html: m.html || '',
  })), (r) => r.model);
  upsert('library', [
    { title: 'Content Fragments', path: panelPath, experience: '' },
    { title: 'Content Advisor', path: `${panelPath}?advisor=1`, experience: 'fullsize-dialog' },
  ], (r) => r.title);
  out[':names'] = [...names];
  return out;
}

async function saveConfig({ org, repo }, token, json) {
  const body = new FormData();
  body.append('config', JSON.stringify(json));
  const res = await fetch(`https://admin.da.live/config/${org}/${repo}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
  if (res.status === 401 || res.status === 403) throw new Error('Only people who can edit this site\'s DA configuration can finish setup. Ask a site admin to open this panel.');
  if (!res.ok) throw new Error(`Saving the setup failed (HTTP ${res.status}). Nothing was changed; try again.`);
}

function previewFrame(html) {
  // no scripts run in it (sandbox without allow-scripts); same origin only so its height can be read
  const frame = el('iframe', {
    class: 'preview', sandbox: 'allow-same-origin', title: 'Sample rendering', srcdoc: `<style>html{color-scheme:light}body{font:14px system-ui;margin:8px}img{max-width:100%;height:auto}</style>${html}`,
  });
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    // fit the content (plus the frame border); again when its images load or fail
    const fit = () => { frame.style.height = `${Math.min(Math.max(doc.documentElement.scrollHeight + 2, 80), 400)}px`; };
    fit();
    doc.querySelectorAll('img').forEach((img) => { img.addEventListener('load', fit); img.addEventListener('error', fit); });
  });
  return frame;
}

function modelCard(model, sample, existing, broker, base) {
  const keepFile = !!existing?.template && !existing?.html;
  const name = model.title || model.name;
  const use = el('input', { type: 'checkbox', checked: !keepFile });
  const area = el('textarea', {
    class: 'nx-input code', rows: 6, spellcheck: 'false', 'aria-label': `Template for ${name}`, value: existing?.html || starterTemplate(model),
  });
  const out = el('div', { class: 'sample' });
  const draw = async () => {
    if (!sample) { out.replaceChildren(el('p', { class: 'muted', text: 'No fragment of this model in the folder to preview.' })); return; }
    try {
      const snap = await broker.get(sample.id);
      out.replaceChildren(
        el('p', { class: 'muted', text: `Sample: ${sample.path.split('/').pop()}, rendered with this template (without the site's styles).` }),
        previewFrame(render(area.value, fragmentData(snap.data, { path: sample.path, ...base }))),
      );
    } catch (e) { out.replaceChildren(el('p', { class: 'error', text: e.message })); }
  };
  let timer;
  area.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 400); });
  draw();
  const fields = (model.fields || []).map((f) => f.label || f.name).join(', ');
  const card = el(
    'li',
    { class: 'model card' },
    el('strong', { text: name }),
    el('p', { class: 'path', text: fields ? `Fields: ${fields}` : model.path }),
    keepFile ? el('p', { class: 'muted', text: `Uses the template file ${existing.template}. Tick "Use this template" to replace it.` }) : null,
    out,
    el('label', { class: 'check' }, use, el('span', { text: 'Use this template' })),
    el('details', {}, el('summary', { text: 'Edit template (HTML)' }), area, el('div', { class: 'actions' }, el('button', {
      type: 'button', class: 'nx-action-btn-quiet', text: 'Reset to starter', onclick: () => { area.value = starterTemplate(model); draw(); },
    }))),
  );
  return { card, value: () => (use.checked ? { model: model.path, label: name, html: area.value.trim() } : null) };
}

const INTRO_TEMPLATES = 'A template decides how a model\'s fragments look on the page; each starts from the model\'s fields. Change one now or later.';
const card = (...kids) => el('section', { class: 'card step' }, ...kids);
/** the first label that applies: [[condition, label], …] → label or '' */
const first = (pairs) => (pairs.find(([on]) => on) || [false, ''])[1];
const fine = (text) => el('p', { class: 'muted', text });
const progress = (n, next) => fine(next ? `Step ${n} of 3. Next: ${next}.` : `Step ${n} of 3.`);
/** one row to pick: name (with badges), detail line; a disabled row says why */
function pickRow({
  name, meta, current, badge, disabled, onPick,
}) {
  return el('li', {}, el(
    'button',
    {
      type: 'button', class: 'pick', disabled, 'aria-current': current ? 'true' : false, onclick: onPick,
    },
    el(
      'span',
      { class: 'pick-text' },
      el('span', { class: 'pick-name' }, name, badge ? el('span', { class: `badge${disabled ? ' quiet' : ''}`, text: badge }) : null),
      el('span', { class: 'pick-meta', text: meta }),
    ),
    disabled ? null : icon('chevrondown'),
  ));
}
/** a filterable list of picks (filter shown from 7 rows) */
function pickList(items, toRow, label) {
  const list = el('ul', { class: 'picks' }, items.map(toRow));
  if (items.length <= 6) return [list];
  const id = `filter-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const filter = el('input', {
    id, class: 'nx-input', type: 'search', placeholder: label, oninput: (e) => {
      const q = e.target.value.trim().toLowerCase();
      list.replaceChildren(...items.filter((it) => !q || it.text.toLowerCase().includes(q)).map(toRow));
    },
  });
  return [el('label', { for: id, class: 'sr-only', text: label }), filter, list];
}
/** a button that opens another step, reporting its error in the status line */
function stepButton(cls, text, run, say) {
  const fail = (e) => say(e.message, 'error');
  return el('button', { type: 'button', class: cls, text, onclick: () => run().catch(fail) });
}
const note = (tone, text) => el('p', { class: `note ${tone}`, text });
/** a term and its value, in the setup summary */
const fact = (term, value, detail) => [el('dt', { text: term }), el('dd', {}, value, detail ? el('span', { class: 'pick-meta', text: detail }) : null)];
const back = (onclick) => el('button', { type: 'button', class: 'nx-action-btn-quiet nx-btn-sm back', onclick }, 'Back');

/**
 * Setup in three cards, one at a time (the ew-monday connect flow):
 * 1. Connect AEM: the user's author environments as rows; 2. the fragment folder: the
 * environment's DAM folders as rows, or a typed path; 3. review the models and save.
 * @param {object} o
 * @param {object} o.sdk DA SDK { context, token }
 * @param {HTMLElement} o.host where the wizard renders
 * @param {object} o.raw the site's DA config JSON as read
 * @param {{ settings, models }} o.config parsed config
 * @param {(opts) => object} o.makeBroker ({ url, author }) → broker
 * @param {string} o.defaultBroker the shared broker deployment
 * @param {(msg, tone?) => void} o.say
 * @param {'first'|'edit'} [o.mode]
 * @param {string} [o.doneKey] sessionStorage key the panel reads after the reload
 */
export default async function runSetup({
  sdk, host, raw, config, makeBroker, defaultBroker, say, mode = 'first', doneKey,
}) {
  const { context, token } = sdk;
  const s = config.settings;
  const state = {
    author: s.author || '',
    folder: s['advisor-folder'] || '',
    broker: s.broker || defaultBroker,
    linkBase: s['link-base'] || '',
  };
  // each step replaces the card; focus moves to its heading so keyboard and screen readers follow
  const show = (...kids) => {
    host.replaceChildren(...kids);
    host.hidden = false;
    const h = host.querySelector('h2');
    if (h) { h.tabIndex = -1; h.focus(); }
  };
  const broker = () => makeBroker({ url: state.broker, author: state.author });
  let authors = [];
  const steps = {}; // the cards; Back links between them
  const envName = (id) => authors.find((a) => a.id === id)?.label || id;
  // nothing is written before Save; when the environment changes, say what that means
  const switching = () => (s.author && state.author !== s.author
    ? note('warn', `Switching from ${envName(s.author)} to ${envName(state.author)}. Pages keep their fragment references, so the same fragments must exist there. Nothing changes until you save on the last step.`)
    : null);
  const saveLabel = mode === 'edit' ? 'Save changes' : 'Save setup';

  /** what Save will change, against the saved setup */
  const changes = (count) => {
    const rows = [];
    if (state.author !== s.author) rows.push(...fact('Environment', envName(state.author), s.author ? `was ${envName(s.author)}` : ''));
    if (state.folder !== s['advisor-folder']) rows.push(...fact('Folder', state.folder, s['advisor-folder'] ? `was ${s['advisor-folder']}` : ''));
    if (state.linkBase !== (s['link-base'] || '')) rows.push(...fact('Link base', state.linkBase || 'None'));
    if (state.broker !== (s.broker || defaultBroker)) rows.push(...fact('Broker', state.broker));
    rows.push(...fact('Templates', `${count} model${count === 1 ? '' : 's'}`));
    return el('dl', { class: 'facts' }, ...rows);
  };

  // 3. review the models found in the folder, then save
  steps.models = async () => {
    say(`Reading ${state.folder}…`);
    const b = broker();
    const items = await b.list(state.folder, 50);
    const byModel = new Map();
    items.forEach((f) => { if (f.model?.id && !byModel.has(f.model.id)) byModel.set(f.model.id, f); });
    if (!byModel.size) throw new Error(`No Content Fragments in ${state.folder}. Pick another folder.`);
    const base = { linkBase: state.linkBase.replace(/\/$/, ''), assetBase: `https://${state.author.replace(/^author-/, 'publish-')}` };
    const models = await Promise.all([...byModel.keys()].map((id) => b.model(id)));
    const samples = [...byModel.values()];
    const existing = (m) => config.models.find((x) => x.model === m.path || x.model === m.id);
    const cards = models.map((m, i) => modelCard(m, samples[i], existing(m), b, base));
    say('');
    const save = el('button', { type: 'button', class: 'nx-btn-accent wide', text: saveLabel });
    save.onclick = async () => {
      save.disabled = true;
      save.textContent = 'Saving…';
      try {
        const settings = {
          broker: state.broker, author: state.author, 'link-base': state.linkBase, 'advisor-folder': state.folder,
        };
        await saveConfig(context, token, mergeConfig(raw, { settings, models: cards.map((c) => c.value()).filter(Boolean), panelPath: window.location.pathname }));
        try { if (doneKey) sessionStorage.setItem(doneKey, envName(state.author)); } catch { /* no storage: no welcome line */ }
        say('Setup saved. Opening the panel…', 'ok');
        setTimeout(() => window.location.reload(), 800);
      } catch (e) { say(e.message, 'error'); save.disabled = false; save.textContent = saveLabel; }
    };
    show(card(
      back(() => steps.folder()),
      el('h2', { text: 'Review the templates' }),
      progress(3),
      switching(),
      el('p', { text: `${models.length} model${models.length > 1 ? 's' : ''} in ${state.folder}. ${INTRO_TEMPLATES}` }),
      el('ul', { class: 'models' }, cards.map((c) => c.card)),
      el('h3', { text: mode === 'edit' ? 'You are about to change' : `You are about to connect ${context.repo}` }),
      changes(cards.length),
      save,
      fine(`Saves to the DA configuration of ${context.org}/${context.repo}. Its other settings are kept.`),
    ));
  };

  // 2. the fragment folder in this environment
  steps.folder = async () => {
    say('');
    const next = () => steps.models().catch((err) => say(err.message, 'error'));
    const choose = (path) => { state.folder = path; next(); };
    const typed = el('input', {
      id: 'setup-folder', class: 'nx-input', autocomplete: 'off', spellcheck: 'false', placeholder: '/content/dam/site/subfolder', value: state.folder,
    });
    const field = (id, label, hint, key, placeholder = '') => [
      el('label', { for: id, text: label }),
      el('input', {
        id, class: 'nx-input', value: state[key], placeholder, oninput: (e) => { state[key] = e.target.value.trim(); },
      }),
      fine(hint),
    ];
    const manual = el(
      'details',
      {},
      el('summary', { text: 'Type a folder path' }),
      el('form', {
        onsubmit: (e) => {
          e.preventDefault();
          const path = typed.value.trim().replace(/\/$/, '');
          if (!/^\/content\/dam\/\S/.test(path)) { say('Type a folder under /content/dam.', 'error'); return; }
          choose(path);
        },
      }, el('label', { for: 'setup-folder', text: 'Folder path' }), typed, el('button', { type: 'submit', class: 'nx-action-btn', text: 'Use this folder' })),
    );
    const more = el(
      'details',
      {},
      el('summary', { text: 'More settings' }),
      ...field('setup-link-base', 'Link base (optional)', 'The site that root-relative links in fragments point to, e.g. https://www.example.com.', 'linkBase', 'https://www.example.com'),
      ...field('setup-broker', 'Broker URL', 'The App Builder action this panel uses to reach AEM.', 'broker'),
    );
    const list = el('div', {}, fine('Loading folders…'));
    show(card(
      back(() => steps.author()),
      el('h2', { text: 'Choose the fragment folder' }),
      progress(2, 'review the templates'),
      switching(),
      el('p', { text: `Where this site's Content Fragments live in ${envName(state.author)}. Models are found there, and Content Advisor opens there.` }),
      list,
      manual,
      more,
    ));
    try {
      const folders = await broker().folders('/content/dam');
      if (!folders.length) throw new Error('none found');
      const suggested = `/content/dam/${context.repo}`.toLowerCase();
      // the saved folder first, then the one named like the site, then the rest
      const isSuggested = (f) => f.path.toLowerCase() === suggested;
      const rank = (f) => [f.path === s['advisor-folder'], isSuggested(f), true].indexOf(true);
      const items = [...folders].sort((a, c) => rank(a) - rank(c)).map((f) => ({ ...f, text: `${f.title} ${f.path}` }));
      const toRow = (f) => {
        const saved = f.path === s['advisor-folder'] && state.author === s.author;
        return pickRow({
          name: f.title, meta: f.path, current: saved, badge: first([[saved, 'Current'], [isSuggested(f), 'Suggested']]), onPick: () => choose(f.path),
        });
      };
      list.replaceChildren(...pickList(items, toRow, 'Filter folders'), fine('Fragments in subfolders are found too. To use a subfolder only, type its path.'));
    } catch (e) {
      list.replaceChildren(fine(`Folders could not be listed (${e.message}). Type the folder path.`));
      manual.open = true;
    }
  };

  // 1. connect AEM: pick the author environment
  steps.author = async () => {
    say('');
    show(card(el('h2', { text: 'Connect AEM' }), fine('Loading your AEM environments…')));
    if (!authors.length) authors = await listAuthors(token);
    if (!authors.length) throw new Error('Your Adobe account cannot reach any AEM Cloud Service author. Ask your AEM admin for access, then reopen this panel.');
    const pick = (a) => {
      if (a.id !== state.author) state.folder = ''; // another environment: its own folders
      state.author = a.id;
      steps.folder().catch((e) => say(e.message, 'error'));
    };
    // the saved environment first, then the rest
    const ordered = [...authors.filter((a) => a.id === s.author), ...authors.filter((a) => a.id !== s.author)]
      .map((a) => ({ ...a, text: `${a.label} ${a.program} ${a.id}` }));
    const toRow = (a) => pickRow({
      name: a.label, meta: a.id, current: a.id === s.author, badge: first([[a.hibernated, 'Hibernated'], [a.id === s.author, 'Current']]), disabled: a.hibernated, onPick: () => pick(a),
    });
    show(card(
      mode === 'edit' ? back(() => steps.summary()) : null,
      el('h2', { text: 'Connect AEM' }),
      progress(1, 'choose the fragment folder'),
      el('p', {
        text: mode === 'edit'
          ? `Pick the AEM author with this site's Content Fragments. Everyone who opens the panel on ${context.repo} uses it.`
          : `Connect ${context.repo} to AEM once, in three steps: the environment, the fragment folder, and how fragments look on the page. Everyone who opens this panel on ${context.repo} then uses it.`,
      }),
      ...pickList(ordered, toRow, 'Filter environments'),
      fine('These are the AEM Cloud Service authors your Adobe account can reach. Fragments are read and saved with your own permissions. Hibernated environments must be woken in Cloud Manager first.'),
    ));
  };

  // edit mode opens on the current setup, with a way to change each part
  steps.summary = async () => {
    say('');
    if (!authors.length) {
      show(card(el('h2', { text: 'Connected to AEM' }), fine('Loading…')));
      authors = await listAuthors(token).catch(() => []);
    }
    const env = authors.find((a) => a.id === s.author);
    const count = config.models.length;
    const btn = (cls, text, run) => stepButton(cls, text, run, say);
    show(card(
      el('h2', { text: 'Connected to AEM' }),
      el('p', { text: `Everyone who opens the panel on ${context.repo} uses this setup.` }),
      el(
        'dl',
        { class: 'facts' },
        ...fact('Environment', env?.label || s.author, env ? s.author : ''),
        ...fact('Fragment folder', s['advisor-folder'] || 'Not set'),
        ...fact('Templates', `${count} model${count === 1 ? '' : 's'} configured`),
      ),
      el(
        'div',
        { class: 'actions' },
        s['advisor-folder'] ? btn('nx-btn-accent', 'Review templates', () => steps.models()) : null,
        btn('nx-action-btn', 'Change folder', () => steps.folder()),
        btn('nx-action-btn-quiet', 'Change environment', () => steps.author()),
      ),
      fine('Changes are saved on the last step, Review templates.'),
      el('button', { type: 'button', class: 'nx-action-btn-quiet nx-btn-sm', text: 'Done', onclick: () => window.location.reload() }),
    ));
  };

  await (mode === 'edit' ? steps.summary() : steps.author());
}
