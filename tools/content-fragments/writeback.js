/*
 * Page text → fragment fields, so text typed straight into a fragment's block on the page can be
 * saved back to AEM. The template is rendered with a marker per field to learn where each field
 * lands (which element, with what literal text around it, e.g. "$" before the price); the same
 * elements are then read from the page's block. A field that shares its element with another
 * field ("{{season}} · {{category}}") cannot be told apart, so it is reported, never guessed.
 */
import { editable } from './broker.js';

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const marker = (i) => `zqcf${i}qz`;
const MARKER = /zqcf(\d+)qz/g;

/** element → its path of element-child indices below `root` */
function pathOf(root, node) {
  const path = [];
  for (let n = node; n && n !== root; n = n.parentElement) path.unshift([...n.parentElement.children].indexOf(n));
  return path;
}

function at(root, path) {
  return path.reduce((n, i) => n?.children?.[i] || null, root);
}

/**
 * Where each field of the fragment lands in the rendered block.
 * @param {(data: object) => string} renderData renders fragment data (`{ fields }`) to block HTML
 * @param {object[]} fields the fragment's fields (name, type, values…)
 * @returns {{ fields: { name, path, prefix, suffix }[], shared: string[] }}
 */
export function fieldMap(renderData, fields, DOMParserImpl = globalThis.DOMParser) {
  const marked = fields.map((f, i) => ({ ...f, values: [marker(i)] }));
  const block = new DOMParserImpl().parseFromString(renderData({ fields: marked }), 'text/html').body.firstElementChild;
  const out = { fields: [], shared: [] };
  if (!block) return out;
  fields.forEach((f, i) => {
    // the deepest element whose text holds this field's marker
    const holders = [...block.querySelectorAll('*')].filter((n) => n.textContent.includes(marker(i)));
    const el = holders.find((n) => ![...n.children].some((c) => c.textContent.includes(marker(i))));
    if (!el) return; // not shown as text (an image src, a link href, or not in the template)
    const text = norm(el.textContent);
    if ((text.match(MARKER) || []).length > 1) { out.shared.push({ name: f.name, path: pathOf(block, el) }); return; }
    const [prefix, suffix] = text.split(marker(i));
    out.fields.push({
      name: f.name, path: pathOf(block, el), prefix, suffix,
    });
  });
  return out;
}

/**
 * The field values the page's block shows, where they differ from AEM's.
 * @param {Element} aemBlock the block as AEM's content renders it: tells whether a line that
 *   holds several fields was edited
 * @returns {{ changes: object, unmappable: string[] }} changes for editable fields only;
 *   unmappable = fields whose page text differs but cannot be saved from here
 */
export function valuesFromBlock(map, block, fields, aemBlock = null) {
  const changes = {};
  const unmappable = [];
  map.fields.forEach(({
    name, path, prefix, suffix,
  }) => {
    const field = fields.find((f) => f.name === name);
    const el = at(block, path);
    const text = el ? norm(el.textContent) : null;
    const value = text !== null && text.startsWith(prefix) && text.endsWith(suffix)
      ? text.slice(prefix.length, text.length - suffix.length).trim() : null;
    const current = norm(field?.values?.[0] ?? '');
    if (value === current) return;
    if (value === null || !field || !editable(field)) unmappable.push(name);
    else changes[name] = value;
  });
  // a line holding several fields: name them only when the page changed that line
  map.shared.forEach(({ name, path }) => {
    const page = at(block, path);
    const aem = aemBlock && at(aemBlock, path);
    if (!aem || norm(page?.textContent) !== norm(aem.textContent)) unmappable.push(name);
  });
  return { changes, unmappable };
}
