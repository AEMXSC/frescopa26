/*
 * Place Content Fragments with Adobe Content Advisor (AEM's fragment picker). Runs in a Workspace
 * full-size dialog: a DA library entry titled "Content Advisor" opening this panel with ?advisor=1.
 * Each picked fragment (and variation) is rendered with its model's template and inserted at the
 * editor cursor as its own section: the block plus Section Metadata (Fragment, Variation), the
 * same form the panel lists and edits, delivered statically like the rest of the page.
 * Based on Mark Szulc's Fréscopa Content Advisor integration (Apache-2.0).
 */

import { imsOrgFor } from './discovery.js';

const SELECTOR_URL = 'https://experience.adobe.com/solutions/CQ-assets-selectors/static-assets/resources/assets-selectors.js';
const DAM = /^\/content\/dam\/[A-Za-z0-9._\-/]+$/;
const VARIATION = /^[A-Za-z0-9_-]{1,64}$/;

function loadScript(src) {
  if (window.PureJSSelectors) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error('Could not load Adobe Content Advisor.')); };
    document.head.append(s);
  });
}

/** Content Advisor's selection → [{ path, variation }], validated */
export function picks(contentFragments) {
  if (!Array.isArray(contentFragments) || !contentFragments.length) throw new Error('Select at least one Content Fragment.');
  return contentFragments.flatMap((f) => {
    if (!DAM.test(f?.path || '')) throw new Error('Content Advisor returned a fragment without a /content/dam path.');
    const variations = Array.isArray(f.variations) && f.variations.length ? f.variations : ['master'];
    return variations.map((v) => {
      const variation = typeof v === 'string' ? v : v?.name;
      if (!VARIATION.test(variation || '')) throw new Error(`Invalid variation for ${f.path}.`);
      return { path: f.path, variation };
    });
  });
}

const cellsOf = (row) => [...row.children];

/** a rendered EDS block (div rows/cells) → the editor's table form, for insertion */
export function blockTable(blockHtml, DOMParserImpl = globalThis.DOMParser) {
  const block = new DOMParserImpl().parseFromString(blockHtml, 'text/html').body.firstElementChild;
  if (!block?.className) throw new Error('The template must render one block (a div with a class).');
  const [name, ...variants] = block.className.trim().split(/\s+/);
  const rows = [...block.children];
  const cols = Math.max(1, ...rows.map((r) => cellsOf(r).length));
  const head = variants.length ? `${name} (${variants.join(', ')})` : name;
  const cell = (c) => `<td>${c.innerHTML}</td>`;
  const body = rows.map((r) => `<tr>${cellsOf(r).map(cell).join('')}</tr>`).join('');
  return `<table><tr><td colspan="${cols}">${head}</td></tr>${body}</table>`;
}

const ESC = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const metaRow = (k, v) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`;

/** a new section: section break, the block, its Section Metadata, section break */
export function sectionInsert(blockHtml, { path, variation }, DOMParserImpl) {
  const rows = [metaRow('Fragment', path)];
  if (variation && variation !== 'master') rows.push(metaRow('Variation', variation));
  return `<hr>${blockTable(blockHtml, DOMParserImpl)}<table><tr><td colspan="2">section-metadata</td></tr>${rows.join('')}</table><hr>`;
}

/**
 * @param {object} o
 * @param {object} o.sdk DA SDK { token, actions }
 * @param {string} o.author author host (repository id)
 * @param {string} [o.folder] optional DAM folder Content Advisor opens on
 * @param {(ref: {path, variation}) => Promise<string>} o.renderRef rendered block HTML for a pick
 * @param {(msg: string, tone?: string) => void} o.say status line
 */
export default async function openAdvisor({
  sdk, author, folder, renderRef, say,
}) {
  const host = document.querySelector('#advisor');
  const insert = document.querySelector('#advisor-insert');
  const cancel = document.querySelector('#advisor-cancel');
  let selected = [];
  let busy = false;
  const close = () => sdk.actions.closeLibrary?.();
  cancel.onclick = close;
  // Cancel is there from the start, so the dialog can be closed if Content Advisor fails to load
  document.querySelector('#advisor-actions').hidden = false;
  say('Loading Adobe Content Advisor…');
  const [imsOrg] = await Promise.all([imsOrgFor(author, sdk.token), loadScript(SELECTOR_URL)]);
  if (typeof window.PureJSSelectors?.renderContentAdvisor !== 'function') throw new Error('Adobe Content Advisor is unavailable.');
  const onSelectionChange = (value) => {
    selected = Array.isArray(value?.contentFragments) ? value.contentFragments : [];
    insert.disabled = busy || !selected.length;
    insert.textContent = selected.length ? `Insert (${selected.length})` : 'Insert';
  };
  const onSubmit = async (value) => {
    if (busy) return;
    busy = true;
    insert.disabled = true;
    try {
      if (value?.repoId && value.repoId !== author) throw new Error(`Pick fragments from ${author}.`);
      const refs = picks(value?.contentFragments ?? selected);
      const html = (await Promise.all(refs.map(async (ref) => sectionInsert(await renderRef(ref), ref)))).join('');
      sdk.actions.sendHTML(html);
      say(`Inserted ${refs.length} fragment section${refs.length > 1 ? 's' : ''} at the cursor.`, 'ok');
      close();
    } catch (e) {
      say(e.message, 'error');
    } finally {
      busy = false;
      insert.disabled = !selected.length;
    }
  };
  insert.onclick = () => onSubmit({ contentFragments: selected });
  host.hidden = false;
  window.PureJSSelectors.renderContentAdvisor(host, {
    imsToken: sdk.token,
    imsOrg,
    repositoryId: author,
    aemTierType: ['author'],
    featureSet: ['advisor', 'content-fragments'],
    defaultSelectedFeature: 'content-fragments',
    noWrap: true,
    onClose: close,
    handleSelection: () => { onSelectionChange(null); say('Choose Content Fragments, not assets.'); },
    onSwitchFeature: () => onSelectionChange(null),
    contentFragmentSelectorProps: {
      imsToken: sdk.token,
      orgId: imsOrg,
      repoId: author,
      ...(folder ? { filters: { folder } } : {}),
      selectionType: 'multiple',
      onSelectionChange,
      onSubmit,
      onDismiss: close,
    },
  });
  say(''); // the dialog's hint says where fragments go
}
