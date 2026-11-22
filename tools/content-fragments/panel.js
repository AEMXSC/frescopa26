/*
 * Content Fragments panel for DA / Experience Workspace (inline library tool).
 * Generic: everything site-specific comes from the DA config sheets `content-fragments`
 * (broker, author) and `content-fragment-models` (model → template). Author content is read and
 * saved through the broker; the preview is updated through cf-bridge on the page.
 * Based on Mark Szulc's Fréscopa Content Fragment plugin (Apache-2.0).
 */
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { readRefs, readConfig } from './refs.js';
import createBroker, { statusOf } from './broker.js';
import { render, fragmentData } from '../../scripts/cf-render.js';
import openEditor from './editor.js';
import openAdvisor from './advisor.js';
import runSetup from './setup.js';
import { imsOrgFor } from './discovery.js';
import { starterTemplate } from './starter.js';
import el, { icon } from './ui.js';

// the shared broker deployment (one App Builder action serves every site); setup can change it
const DEFAULT_BROKER = 'https://3635370-dacontentfragments-stage.adobeioruntime.net/api/v1/web/da-cf/cf';
const SETUP_DONE = 'cf-setup-done';

const $ = (sel) => document.querySelector(sel);
const say = (msg, tone = '') => { const s = $('#status'); s.textContent = msg; s.dataset.tone = tone; };
const pageKey = (p) => String(p || '/').replace(/\.html$/, '').replace(/\/index$/, '/');
const templates = new Map();

let broker;
let config;
let page;
let sdk; // { context, token, actions }
let live; // the editor's live document: { html, selection: { blockIndex }, editable }
let org; // Promise<IMS org of the author | null>, for "Open in AEM" links

const linkBase = () => (config.settings['link-base'] || '').replace(/\/$/, '');
// images referenced by fragments load from AEM publish (setting `asset-base` overrides)
const assetBase = () => (config.settings['asset-base'] || `https://${broker.author.replace(/^author-/, 'publish-')}`).replace(/\/$/, '');

// the site's EDS redirects sheet (/redirects.json, same origin as this panel): a fragment link to a
// page already moved to this site resolves to the moved page, as the site's build does. Optional.
let redirects = null;
async function loadRedirects() {
  try {
    const res = await fetch('/redirects.json', { cache: 'no-store' });
    if (!res.ok) return;
    const json = await res.json();
    const rows = json?.data || json?.default?.data || [];
    redirects = Object.fromEntries(rows.filter((r) => r.Source && r.Destination).map((r) => [r.Source, r.Destination]));
  } catch { redirects = null; } // no sheet: links use the link base only
}

/** preview the page (EDS admin allows this origin), after the editor saved it */
async function previewPage() {
  const { org: daOrg, repo } = sdk.context;
  const p = sdk.context.path.replace(/\/index$/, '/');
  const res = await fetch(`https://admin.hlx.page/preview/${daOrg}/${repo}/main${p}`, {
    method: 'POST', headers: { Authorization: `Bearer ${sdk.token}`, 'x-content-source-authorization': `Bearer ${sdk.token}` },
  });
  if (!res.ok) throw new Error(`Applied in the editor, but the page preview did not update (HTTP ${res.status}). Use Preview in the editor.`);
}
// BroadcastChannel only connects documents of the same origin (this site's preview): no origin
// check is needed, and every message is still checked for this page and a /content/dam path
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('da-content-fragments') : null;

function post(msg) { channel?.postMessage({ page, ...msg }); }

// listeners for editor documents and preview replies (each open fragment editor registers)
const liveListeners = new Set();
const renderedListeners = new Set();

let previewConnected = false;
function previewState(on) {
  previewConnected = previewConnected || on;
  const s = $('#preview-state');
  s.dataset.tone = previewConnected ? 'ok' : 'warn';
  s.lastElementChild.textContent = previewConnected
    ? 'Live preview on'
    : 'Live preview off: reload the page preview to see edits as you type.';
  s.title = previewConnected ? '' : 'The page preview is not running cf-bridge.js, or is on another origin.';
}

/** the model's template: saved by setup (`html`), a template file, else the starter (cf-card) */
async function template(fragment) {
  const m = config.models.find((x) => [fragment.model?.path, fragment.model?.id, fragment.model?.name].includes(x.model)
    || (fragment.model?.path || '').endsWith(`/${x.model}`));
  if (m?.html) return m.html;
  if (!m?.template) {
    const id = fragment.model?.id;
    if (!id) return null;
    if (!templates.has(id)) templates.set(id, broker.model(id).then((model) => starterTemplate(model)));
    return templates.get(id);
  }
  if (!templates.has(m.template)) {
    templates.set(m.template, fetch(m.template, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`Template ${m.template} returned HTTP ${r.status}.`);
      return r.text();
    }));
  }
  return templates.get(m.template);
}

/**
 * The fragment in AEM's editor. `@<IMS org>` makes Experience Cloud switch to the author's org
 * (and rewrite it to the org's tenant), so no tenant needs configuring; the `tenant` setting is
 * only a fallback when the org cannot be found.
 */
async function editorUrl(id) {
  const u = new URL('https://experience.adobe.com/');
  u.searchParams.set('repo', broker.author);
  const owner = (await org) || config.settings.tenant || '';
  const prefix = owner ? `@${owner}/` : '';
  u.hash = `/${prefix}aem/cf/editor/editor/${encodeURIComponent(id)}`;
  return u.href;
}

const services = {
  get broker() { return broker; },
  get sdk() { return sdk; },
  live: () => live,
  onLive: (fn) => liveListeners.add(fn),
  onRendered: (fn) => renderedListeners.add(fn),
  post,
  previewOn: () => previewConnected,
  template,
  rendered: (tpl, data, ref) => render(tpl, fragmentData(data, {
    path: ref.path, variation: ref.variation, linkBase: linkBase(), redirects, assetBase: assetBase(),
  })),
  editorUrl,
  previewPage,
};

function row(ref) {
  const name = ref.path.split('/').pop();
  const light = el('span', { class: 'light', 'data-tone': 'unknown' }, el('i', { 'aria-hidden': 'true' }), el('span', { text: 'Checking…' }));
  const setLight = (tone, label, title) => {
    light.dataset.tone = tone;
    light.lastChild.textContent = label;
    if (title) light.title = title;
  };
  const body = el('div', { class: 'body', hidden: true });
  const unsaved = el('span', { class: 'unsaved', text: 'Unsaved', hidden: true });
  const lookup = () => broker.byPath(ref.path).then((f) => {
    if (!f) { setLight('error', 'Not found in AEM'); return null; }
    const st = statusOf(f);
    setLight(st.tone, st.label, f.id);
    return f;
  });
  const found = lookup().catch((e) => { setLight('unknown', 'AEM unavailable', e.message); say(e.message, 'error'); return null; });
  const api = { dirty: (on) => { unsaved.hidden = !on; }, refresh: () => lookup().catch(() => {}) };
  const fail = (e) => body.replaceChildren(el('p', { class: 'error', text: e.message }));
  const toggle = el('button', {
    type: 'button', class: 'name', 'aria-expanded': 'false',
    onclick: async () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      body.hidden = open;
      post({ type: 'locate', path: ref.path, variation: ref.variation });
      if (open || body.childElementCount) return;
      body.replaceChildren(el('p', { class: 'muted', text: 'Finding this fragment in AEM…' }));
      const fragment = await found;
      if (!fragment) { fail(new Error('This fragment was not found in AEM author, so it cannot be edited here.')); return; }
      openEditor(services, ref, fragment, body, api).catch(fail);
    },
  }, icon('chevrondown'), el('span', { class: 'name-text' }, el('strong', { text: name }), el('span', { class: 'variation', text: ref.variation === 'master' ? 'Main' : ref.variation }), unsaved));
  return el('li', { class: 'ref' }, toggle, el('div', { class: 'meta' }, light, el('span', { class: 'path', text: ref.path })), body);
}

// the editor's live document, when the host sends one (within ~2 s of subscribing)
let onLive; // set once the list is drawn: redraws it when the page's fragments change
function liveDocument(actions) {
  return new Promise((resolve) => {
    if (!actions?.subscribeLiveDocument) { resolve(null); return; }
    let first = true;
    actions.subscribeLiveDocument((snapshot) => {
      live = snapshot;
      if (first) { first = false; resolve(snapshot); } else onLive?.(snapshot.html);
      liveListeners.forEach((fn) => fn(snapshot));
    });
    setTimeout(() => resolve(live || null), 2000);
  });
}

const refsKey = (refs) => refs.map((r) => `${r.path}#${r.variation}`).join('|');
let shownKey = '';
function drawRefs(refs) {
  shownKey = refsKey(refs);
  $('#count').textContent = refs.length;
  $('#refs').replaceChildren(...refs.map(row));
  if (!refs.length) say('No Content Fragments on this page yet. Use "Browse with Content Advisor" below to place one.');
}

/** a fragment (or variation) rendered with its model's template: what Content Advisor inserts */
async function renderRef({ path, variation }) {
  const fragment = await broker.byPath(path);
  if (!fragment) throw new Error(`${path} was not found on ${broker.author}.`);
  const tpl = await template(fragment);
  if (!tpl) throw new Error(`The model of ${path} has no template. Open Setup to add one.`);
  const snap = await broker.get(fragment.id, variation);
  return services.rendered(tpl, snap.data, { path, variation });
}

/** once, right after setup saved and reloaded: say what is now available */
function welcome() {
  let env;
  try { env = sessionStorage.getItem(SETUP_DONE); sessionStorage.removeItem(SETUP_DONE); } catch { env = null; }
  if (env) say(`Connected to ${env}. Edit the fragments on this page below, or place new ones with Content Advisor.`, 'ok');
}

async function init() {
  sdk = await DA_SDK;
  const { context, token, actions } = sdk;
  const getToken = () => token;
  page = pageKey(context.path);
  const headers = { Authorization: `Bearer ${token}` };
  const cfg = await fetch(`https://admin.da.live/config/${context.org}/${context.repo}`, { headers });
  if (!cfg.ok && cfg.status !== 404) throw new Error(`Could not read this site's DA configuration (HTTP ${cfg.status}). Reload the panel; if it keeps failing, check that you can open the site in DA.`);
  const raw = cfg.ok ? await cfg.json() : {}; // 404: the site has no config yet
  config = readConfig(raw);
  await loadRedirects();
  const setup = (mode) => {
    document.body.classList.add('setup-mode');
    return runSetup({
      sdk, host: $('#setup'), raw, config, makeBroker: (o) => createBroker({ ...o, getToken }), defaultBroker: DEFAULT_BROKER, say, mode, doneKey: SETUP_DONE,
    });
  };
  // first run on this site: the setup wizard instead of the list
  if (!config.settings.author || !config.settings.broker) {
    $('#author').textContent = 'Not connected yet';
    await setup('first');
    return;
  }
  $('#setup-open').hidden = false;
  $('#setup-open').onclick = () => setup('edit').catch((e) => say(e.message, 'error'));
  broker = createBroker({ url: config.settings.broker, author: config.settings.author, getToken });
  org = imsOrgFor(broker.author, token).catch(() => null);
  $('#author').textContent = broker.author;
  if (new URLSearchParams(window.location.search).get('advisor') === '1') {
    document.body.classList.add('advisor-mode');
    $('.title').textContent = 'Place Content Fragments';
    $('#advisor-hint').hidden = false;
    await openAdvisor({
      sdk, author: broker.author, folder: config.settings['advisor-folder'], renderRef, say,
    });
    return;
  }
  welcome();
  // what the author has open now (the live editor document), else the stored source
  let html = (await liveDocument(actions))?.html;
  if (!html) {
    const doc = await fetch(`https://admin.da.live/source/${context.org}/${context.repo}${context.path.replace(/\/$/, '/index')}.html`, { headers });
    if (!doc.ok) throw new Error(`Could not read this page from DA (HTTP ${doc.status}). Save the page in the editor, then reopen the panel.`);
    html = await doc.text();
  }
  drawRefs(readRefs(html));
  let timer;
  onLive = (next) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const refs = readRefs(next);
      if (refsKey(refs) !== shownKey) drawRefs(refs); // a fragment section was added or removed
    }, 600);
  };
  $('#browse').prepend(icon('add'));
  $('#browse').onclick = () => actions.showPanel?.('content-advisor');
  channel?.addEventListener('message', ({ origin, data }) => {
    if (origin !== window.location.origin || data?.page !== page) return;
    if (data.type === 'ready') previewState(true);
    if (data.type === 'rendered') renderedListeners.forEach((fn) => fn(data));
    if (data.type === 'error') say(`Preview: ${data.message}`, 'error');
    if (data.type === 'rendered' && !data.count) say('This fragment is not visible in the current preview (another cohort or variation may be showing).');
    if (data.type === 'reverted') say('Layout view redrew this block from the page document, so the preview shows the saved page. Save to AEM, then Apply to page to see the change.', 'warn');
  });
  // is the page preview listening? (the site loads cf-bridge.js in its preview frames)
  post({ type: 'ping' });
  setTimeout(() => { if (!previewConnected) previewState(false); }, 5000);
}

init().catch((e) => say(e.message, 'error'));
