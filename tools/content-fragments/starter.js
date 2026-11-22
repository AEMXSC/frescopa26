/*
 * A starter template from a Content Fragment model's fields, for models without a template: the
 * setup wizard offers it (editable), and the panel falls back to it, so any fragment can be
 * placed. It renders the generic `cf-card` block (site/blocks/cf-card): an image cell when the
 * model has an image reference, then a text cell with the title, the other fields and a link.
 */

const TITLE_NAMES = ['title', 'headline', 'heading', 'name', 'label'];
const LINK = /(url|href)$/i; // the fields fragmentData resolves as links
const LABEL_FOR = (base) => [`${base}label`, `${base}text`, `${base}title`];
const SKIP_TYPES = new Set(['boolean', 'json', 'content-fragment', 'tag', 'tags']);
const LIST_TYPES = new Set(['text', 'long-text', 'number', 'date-time', 'date', 'time', 'enumeration', 'float-number', 'long-number']);

const single = (f) => f && !f.multiple;
const lower = (s) => String(s || '').toLowerCase();

/** which field plays which part: { image, title, link, linkLabel, rest[] } */
export function roles(fields) {
  const usable = (fields || []).filter((f) => single(f) && f.name && !SKIP_TYPES.has(f.type));
  const texts = usable.filter((f) => f.type === 'text');
  const image = usable.find((f) => f.type === 'content-reference');
  const title = TITLE_NAMES.map((n) => texts.find((f) => lower(f.name) === n)).find(Boolean) || texts[0];
  const link = texts.find((f) => f !== title && LINK.test(f.name));
  const base = link ? lower(link.name).replace(LINK, '') : null;
  const linkLabel = link && texts.find((f) => f !== title && LABEL_FOR(base).includes(lower(f.name)));
  const used = new Set([image, title, link, linkLabel].filter(Boolean));
  const rest = usable.filter((f) => !used.has(f) && LIST_TYPES.has(f.type));
  return {
    image, title, link, linkLabel, rest,
  };
}

const tag = (f) => `{{${f.name}}}`;
const LITERAL = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '{': '&#123;', '}': '&#125;',
};
// model text written into the template itself: HTML-escaped, and never read as a tag
const literal = (s) => String(s).replace(/[&<>"{}]/g, (c) => LITERAL[c]);
const html = (f) => (f.mimeType === 'text/html' ? `{{{${f.name}}}}` : tag(f));

function fieldLine(f) {
  // long text reads as prose; a short value reads better with its model label
  if (f.type === 'long-text') {
    return f.mimeType === 'text/html' ? `{{#${f.name}}}<div>${html(f)}</div>{{/${f.name}}}` : `{{#${f.name}}}<p>${tag(f)}</p>{{/${f.name}}}`;
  }
  return `{{#${f.name}}}<p><strong>${literal(f.label || f.name)}</strong> ${tag(f)}</p>{{/${f.name}}}`;
}

/** @param {{ fields }} model a Management API model @returns {string} one-line template */
export function starterTemplate(model, { block = 'cf-card' } = {}) {
  const r = roles(model?.fields);
  const heading = r.title ? `<h3>${tag(r.title)}</h3>` : '';
  const titled = r.title && r.link && !r.linkLabel
    ? `{{#${r.link.name}}}<h3><a href="${tag(r.link)}">${tag(r.title)}</a></h3>{{/${r.link.name}}}{{^${r.link.name}}}${heading}{{/${r.link.name}}}`
    : heading;
  const cta = r.link && r.linkLabel ? `{{#${r.link.name}}}<p><a href="${tag(r.link)}">${tag(r.linkLabel)}</a></p>{{/${r.link.name}}}` : '';
  const text = `<div>${titled}${r.rest.map(fieldLine).join('')}${cta}</div>`;
  const alt = r.title ? tag(r.title) : '';
  const image = r.image ? `{{#${r.image.name}}}<div><picture><img src="${tag(r.image)}" alt="${alt}"></picture></div>{{/${r.image.name}}}` : '';
  return `<div class="${block}"><div>${image}${text}</div></div>`;
}
