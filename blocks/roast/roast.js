/**
 * Roast — detail view for a structured content record of schema "roast".
 *
 * Experience Workspace renders a structured content document as a block named
 * after its schema, one row per field:
 *   <div class="roast">
 *     <div><div><h3>name</h3></div><div>Morning Ritual</div></div>
 *     <div><div><h3>tastingNotes</h3></div><div><ul><li>…</li></ul></div></div>
 *   </div>
 * This block reads those rows from the page itself (no fetch) and builds the
 * product view. Field keys come from the label heading's text, which keeps the
 * schema's original casing.
 */
import { createOptimizedPicture } from '../../scripts/aem.js';

function readFields(block) {
  const fields = {};
  [...block.children].forEach((row) => {
    const [labelCell, valueCell] = row.children;
    const key = labelCell?.textContent.trim();
    if (!key || !valueCell) return;
    const list = valueCell.querySelector('ul, ol');
    fields[key] = list
      ? [...list.querySelectorAll('li')].map((li) => li.textContent.trim()).filter(Boolean)
      : valueCell.textContent.trim();
  });
  return fields;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function formatPrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

/**
 * Image from the record's "image" URL field. EDS media (…/media_<hash>.ext,
 * on any aem.page/aem.live host) is rendered as a responsive picture from the
 * current host; any other https URL is used as-is. Returns null if invalid.
 */
export function buildImage(value, alt = '', eager = false) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (/^\/(media\/)?media_[0-9a-f]+\.(jpe?g|png|webp|gif)$/i.test(url.pathname)) {
    return createOptimizedPicture(url.pathname, alt, eager, [{ media: '(min-width: 900px)', width: '1200' }, { width: '750' }]);
  }
  const img = document.createElement('img');
  img.src = url.href;
  img.alt = alt;
  img.loading = eager ? 'eager' : 'lazy';
  return img;
}

export function buildNotes(notes) {
  const list = el('ul', 'roast-notes');
  (Array.isArray(notes) ? notes : []).forEach((note) => list.append(el('li', '', note)));
  return list;
}

export default function decorate(block) {
  const f = readFields(block);
  const level = (f.roastLevel || '').toLowerCase();

  const media = el('div', `roast-media roast-level-${level || 'unknown'}`);
  const image = buildImage(f.image, f.imageAlt || f.name || '', true);
  if (image) media.append(image);
  else media.append(el('span', 'roast-media-label', f.roastLevel ? `${f.roastLevel} roast` : 'Roast'));

  const body = el('div', 'roast-body');
  if (f.origin) body.append(el('p', 'roast-origin', f.origin));
  body.append(el('h1', 'roast-name', f.name || 'Untitled roast'));
  if (f.description) body.append(el('p', 'roast-desc', f.description));
  if (f.tastingNotes?.length) body.append(buildNotes(f.tastingNotes));

  const foot = el('div', 'roast-foot');
  const price = formatPrice(f.price);
  if (price) foot.append(el('span', 'roast-price', price));
  if (f.bagSize) foot.append(el('span', 'roast-size', f.bagSize));
  if (foot.children.length) body.append(foot);

  if (f.featured === 'true') media.append(el('span', 'roast-badge', 'Most loved'));

  block.textContent = '';
  block.append(media, body);
}
