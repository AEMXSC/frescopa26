/*
 * cf-bridge: runs in the page preview inside Experience Workspace (same origin as the panel).
 * The Content Fragments panel renders a fragment's template with author content and posts the
 * result here; the bridge swaps it into the sections that reference that fragment + variation
 * (Section Metadata `Fragment` / `Variation`, or a Content Fragment block) and lets the site's
 * own block code decorate it again. Nothing is saved: reload the preview to see the stored page.
 *
 *   import('./cf-bridge.js').then((m) => m.default({ decorateButtons, decorateBlock, loadBlock }));
 *
 * Messages on BroadcastChannel `da-content-fragments`, scoped to this page path:
 *   { type: 'render', page, path, variation, html }  html = authored block markup, rows to replace
 *   { type: 'locate', page, path, variation }
 * Replies: { type: 'rendered' | 'located' | 'error', page, path, variation, count, message }
 */

const CHANNEL = 'da-content-fragments';
let authored; // the page's stored markup (.plain.html), for the blocks' undecorated rows

const page = () => window.location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/');

async function plain() {
  if (!authored) {
    const p = page();
    const doc = p.endsWith('/') ? `${p}index` : p;
    const res = await fetch(`${doc}.plain.html`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not read the page markup (HTTP ${res.status}).`);
    authored = new DOMParser().parseFromString(await res.text(), 'text/html').body;
  }
  return authored;
}

function sectionsFor(path, variation) {
  const v = variation || 'master';
  return [...document.querySelectorAll('main > .section')].filter((s) => {
    if (s.dataset.fragment === path && (s.dataset.variation || 'master').toLowerCase() === v) return true;
    return [...s.querySelectorAll('.content-fragment')].some((b) => b.textContent.includes(path));
  });
}

function flash(section) {
  section.style.outline = '3px solid #3b63fb';
  section.style.outlineOffset = '4px';
  setTimeout(() => { section.style.outline = ''; section.style.outlineOffset = ''; }, 2500);
}

// attributes the editor (layout view) owns on page elements: kept, never copied from new markup
const EDITOR_ATTR = /^(data-prose-|data-image-|data-block-|data-cursor-|data-aue-|contenteditable$|spellcheck$)/;
const editorAttrs = (node) => [...(node.attributes || [])].filter((a) => EDITOR_ATTR.test(a.name));

function syncAttributes(live, next) {
  [...live.attributes].forEach((a) => {
    if (!EDITOR_ATTR.test(a.name) && !next.hasAttribute(a.name)) live.removeAttribute(a.name);
  });
  [...next.attributes].forEach((a) => {
    if (!EDITOR_ATTR.test(a.name) && live.getAttribute(a.name) !== a.value) {
      live.setAttribute(a.name, a.value);
    }
  });
}

function replaceKeepingIndexes(live, next) {
  if (next.nodeType === Node.ELEMENT_NODE) {
    editorAttrs(live).forEach((a) => next.setAttribute(a.name, a.value));
  }
  live.replaceWith(next);
}

const kind = (n) => (n.nodeType === Node.ELEMENT_NODE ? n.nodeName : `#${n.nodeType}`);

/**
 * Pair live and new children of the same kind, in order (longest common subsequence), so an
 * added or removed paragraph does not shift every later element: Map(new index → live index).
 */
function align(old, kids) {
  const n = old.length;
  const m = kids.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = kind(old[i]) === kind(kids[j])
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const pairs = new Map();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (kind(old[i]) === kind(kids[j])) {
      pairs.set(j, i);
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i += 1;
    else j += 1;
  }
  return pairs;
}

/**
 * Make `live` look like `next` while keeping live nodes where the structure matches: changed text
 * is updated in the existing text node, attributes are synced, and only a structural difference
 * (another element in that place) replaces an element, carrying the editor's attributes over.
 */
export function morph(live, next) {
  if (live.nodeType === Node.TEXT_NODE && next.nodeType === Node.TEXT_NODE) {
    if (live.data !== next.data) live.data = next.data;
    return;
  }
  if (live.nodeType !== next.nodeType || live.nodeName !== next.nodeName) {
    replaceKeepingIndexes(live, next);
    return;
  }
  if (live.nodeType !== Node.ELEMENT_NODE) return;
  // data-block-status / data-block-name stay as they are on the live block (see EDITOR_ATTR)
  syncAttributes(live, next);
  const kids = [...next.childNodes];
  const old = [...live.childNodes];
  const pairs = align(old, kids);
  kids.forEach((kid, j) => {
    const i = pairs.get(j);
    if (i !== undefined) { morph(old[i], kid); return; }
    // an added node goes before the next live node that is kept
    const after = [...pairs.entries()].find(([jj]) => jj > j);
    if (after) old[after[1]].before(kid); else live.append(kid);
  });
  const kept = new Set(pairs.values());
  old.forEach((n, i) => { if (!kept.has(i)) n.remove(); });
}

// the stored section with the same Fragment/Variation metadata (not by position: personalization
// can remove sections from the live DOM)
function storedSection(body, path, variation) {
  const v = variation || 'master';
  return [...body.children].find((sec) => {
    // .plain.html carries Section Metadata as data-* attributes on the section
    if (sec.dataset.fragment === path && (sec.dataset.variation || 'master').toLowerCase() === v) return true;
    const meta = sec.querySelector(':scope > .section-metadata');
    if (meta) {
      const cells = (r) => [...r.children].map((c) => c.textContent.trim().toLowerCase());
      const kv = Object.fromEntries([...meta.children].map(cells));
      if (kv.fragment === path.toLowerCase() && (kv.variation || 'master') === v) return true;
    }
    return [...sec.querySelectorAll(':scope > .content-fragment')].some((b) => b.textContent.includes(path));
  });
}

async function swap(section, html, hooks, path, variation) {
  const source = storedSection(await plain(), path, variation);
  const fresh = new DOMParser().parseFromString(html, 'text/html').body.firstElementChild;
  const current = section.querySelector('.block');
  if (!source || !fresh || !current) throw new Error('No block to update in this section.');
  const name = current.dataset.blockName;
  const original = [...source.children].find((el) => el.classList.contains(name));
  if (!original) throw new Error(`The stored page has no ${name} block here.`);
  // the template's rows replace the first rows of the stored block; the rest (e.g. tiles) stay
  const block = original.cloneNode(true);
  [...fresh.children].forEach((row, i) => {
    if (block.children[i]) block.children[i].replaceWith(row.cloneNode(true));
    else block.append(row.cloneNode(true));
  });
  // decorate the new version off-page with the site's own code, then merge it into the live block
  // in place: Experience Workspace layout view tracks the block (data-block-index) and its text
  // (data-prose-index) and must keep them, so the block element is never replaced
  const holder = document.createElement('div');
  holder.append(block);
  hooks.decorateButtons?.(holder);
  hooks.decorateIcons?.(holder);
  hooks.decorateBlock(block);
  await hooks.loadBlock(block);
  morph(current, block);
  flash(section);
}

// in the editor's preview only: mark sections whose text comes from AEM, so authors edit them in
// the panel. Pure CSS (an outline and a ::before label): nothing is added to the page's DOM, so
// nothing can be saved into the document
const LABEL_CSS = `
main > .section[data-fragment] { position: relative; outline: 2px dashed #3b63fb; outline-offset: 4px; }
main > .section[data-fragment]::before {
  content: 'From AEM \\00B7  edit in the Content Fragments panel';
  position: absolute; top: 0; left: 0; z-index: 2; transform: translateY(-100%);
  padding: 2px 8px; border-radius: 4px 4px 0 0;
  background: #3b63fb; color: #fff; font: 600 12px/1.5 system-ui, sans-serif;
}`;

function labelSections() {
  if (document.getElementById('cf-bridge-labels')) return;
  const style = document.createElement('style');
  style.id = 'cf-bridge-labels';
  style.textContent = LABEL_CSS;
  document.head.append(style);
}

export default function startBridge(hooks = {}) {
  if (!hooks.decorateBlock || !hooks.loadBlock) throw new Error('cf-bridge needs decorateBlock and loadBlock.');
  if (window.self === window.top || typeof BroadcastChannel === 'undefined') return;
  labelSections();
  const channel = new BroadcastChannel(CHANNEL);
  const reply = (msg) => channel.postMessage({ page: page(), ...msg });
  channel.addEventListener('message', async ({ origin, data }) => {
    if (origin !== window.location.origin || !data || data.page !== page()) return;
    if (data.type === 'ping') { reply({ type: 'ready' }); return; }
    if (!/^\/content\/dam\//.test(data.path || '')) return;
    const { path, variation } = data;
    const sections = sectionsFor(path, variation);
    try {
      if (data.type === 'locate') {
        if (sections[0]) {
          sections[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
          sections.forEach(flash);
        }
        reply({
          type: 'located', path, variation, count: sections.length,
        });
      } else if (data.type === 'render' && typeof data.html === 'string') {
        await Promise.all(sections.map((s) => swap(s, data.html, hooks, path, variation)));
        if (sections[0]) sections[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        reply({
          type: 'rendered', path, variation, count: sections.length,
        });
        // layout view keeps the preview in step with the document: if it redraws the block, say so
        const expect = new DOMParser().parseFromString(data.html, 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
        setTimeout(() => {
          const shown = sections.map((s) => s.textContent.replace(/\s+/g, ' ')).join(' ');
          if (sections.length && expect && !shown.includes(expect.slice(0, 60))) reply({ type: 'reverted', path, variation });
        }, 1200);
      }
    } catch (e) {
      reply({
        type: 'error', path, variation, message: e.message,
      });
    }
  });
  reply({ type: 'ready' });
}
