/*
 * Apply a re-rendered fragment block to the page open in the DA editor, through the editor
 * (DA SDK `sendHTML` replace), never around it: a document open in DA is a live collaborative
 * session, and a write to its stored source is overwritten by the next editor save.
 *
 * The SDK replaces only the block selected in the editor, guarded by `expected` (the document
 * and selection the panel saw): if either changed, nothing is written. So the author clicks inside
 * the block, then Apply.
 */

import { sectionMeta } from './refs.js';

/**
 * The block a reference points at in the live document: { index, block } or null. `index` is the
 * block's ordinal among `div[data-block-index]` (every non-metadata block, document order), which is
 * how the editor counts `selection.blockIndex`; the attribute's own value is an editor position.
 */
export function findBlock(html, { path, variation }, DOMParserImpl = globalThis.DOMParser) {
  const doc = new DOMParserImpl().parseFromString(html, 'text/html');
  const blocks = [...doc.querySelectorAll('div[data-block-index]')];
  const v = variation || 'master';
  const main = doc.querySelector('main') || doc.body;
  const section = [...main.children].find((sec) => {
    const meta = sectionMeta(sec);
    return String(meta.fragment || '').trim().toLowerCase() === path.toLowerCase()
      && (String(meta.variation || '').trim().toLowerCase() || 'master') === v;
  });
  const block = section && [...section.querySelectorAll(':scope > div[data-block-index]')].find((b) => !b.classList.contains('section-metadata'));
  return block ? { index: blocks.indexOf(block), block } : null;
}

const rowTexts = (block) => [...block.children].map((r) => r.textContent.replace(/\s+/g, ' ').trim());

/**
 * Does the page's block show other text than the fragment rendered from AEM? true / false, or
 * null when the block is not in the page. Text only, row by row over the template's rows (the
 * rows Apply replaces): someone edited the page directly, or AEM changed since the last Apply.
 */
export function differsFromPage(html, ref, renderedHtml, DOMParserImpl = globalThis.DOMParser) {
  const found = findBlock(html, ref, DOMParserImpl);
  const fresh = new DOMParserImpl().parseFromString(renderedHtml, 'text/html').body.firstElementChild;
  if (!found || !fresh) return null;
  const page = rowTexts(found.block);
  return rowTexts(fresh).some((text, i) => text !== (page[i] ?? ''));
}

/** the stored block with the template's rows in place of its first rows (later rows kept) */
export function mergeRows(block, renderedHtml, DOMParserImpl = globalThis.DOMParser) {
  const fresh = new DOMParserImpl().parseFromString(renderedHtml, 'text/html').body.firstElementChild;
  if (!fresh) throw new Error('The template rendered nothing.');
  const out = block.cloneNode(true);
  [...fresh.children].forEach((row, i) => {
    const copy = out.ownerDocument.importNode(row, true);
    if (out.children[i]) out.children[i].replaceWith(copy);
    else out.append(copy);
  });
  out.removeAttribute('data-block-index');
  out.querySelectorAll('[data-block-index]').forEach((n) => n.removeAttribute('data-block-index'));
  return out.outerHTML;
}

/**
 * @returns {Promise<string>} what happened, for the status line
 */
export async function applyToPage({
  actions, live, ref, renderedHtml, preview,
}) {
  if (!live?.html) throw new Error('The editor has not sent the page yet: open the page in Layout or Split view.');
  if (live.editable === false) throw new Error('This page is read-only in the editor.');
  const found = findBlock(live.html, ref);
  if (!found) throw new Error('This fragment\'s block is not in the open page.');
  if (live.selection?.blockIndex !== found.index) {
    const name = found.block.classList[0] || 'block';
    throw new Error(`Click inside the ${name} block for "${ref.variation}" in the editor, then Apply.`);
  }
  const result = await actions.sendHTML(mergeRows(found.block, renderedHtml), {
    replace: true,
    expected: { html: live.html, blockIndex: found.index },
  });
  if (!result?.ok) throw new Error(`The editor did not apply it (${result?.error || 'no response'}): the page changed, select the block again.`);
  await actions.saveDocument?.();
  if (preview) await preview();
  return preview ? 'Applied to the page and previewed. Publish the page to update the live site.' : 'Applied to the page.';
}
