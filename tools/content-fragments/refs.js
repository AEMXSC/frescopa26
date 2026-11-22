/*
 * Which Content Fragments a page uses, read from its DA document (not from the rendered preview,
 * so it works before the page is previewed and on any template). Two authoring forms:
 *
 *   1. Section Metadata on any section:   Fragment | /content/dam/site/hero
 *                                          Variation | cardholder        (optional)
 *   2. A Content Fragment block:           | Content Fragment |
 *                                          | /content/dam/site/faq-1 |  (one path per line/row;
 *                                          | variation | spring |         optional variation row)
 *
 * Also the site config (DA config sheet `content-fragments`, key/value rows) and model templates
 * (sheet `content-fragment-models`: model, template, label).
 */

const DAM = /^\/content\/dam\/[A-Za-z0-9._\-/]+$/;
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '-');

function rowsOf(block) {
  return [...block.children].map((row) => [...row.children].map((c) => c.textContent.trim()));
}

/**
 * A section's Fragment / Variation, from either form a page arrives in: a Section Metadata block
 * (the stored DA document), or data-* attributes on the section (the editor's live document and
 * .plain.html, where the metadata block is applied and removed).
 * @returns {{ fragment?: string, variation?: string }}
 */
export function sectionMeta(section) {
  const block = section.querySelector(':scope > .section-metadata');
  if (block) {
    return Object.fromEntries(rowsOf(block).filter((r) => r.length >= 2).map(([k, v]) => [norm(k), v]));
  }
  return {
    fragment: section.getAttribute('data-fragment') || undefined,
    variation: section.getAttribute('data-variation') || undefined,
  };
}

/** @returns {{ path, variation, section, kind }[]} in document order, unique by path+variation */
export function readRefs(html, DOMParserImpl = globalThis.DOMParser) {
  const doc = new DOMParserImpl().parseFromString(html, 'text/html');
  const main = doc.querySelector('main') || doc.body;
  const out = [];
  const seen = new Set();
  const add = (path, variation, section, kind) => {
    const p = String(path || '').trim();
    if (!DAM.test(p) || p.split('/').some((s) => s === '..')) return;
    const v = variation ? norm(variation) : 'master';
    const key = `${p}#${v}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      path: p, variation: v, section, kind,
    });
  };
  [...main.children].forEach((section, i) => {
    const meta = sectionMeta(section);
    if (meta.fragment) add(meta.fragment, meta.variation, i, 'section');
    section.querySelectorAll(':scope > .content-fragment').forEach((block) => {
      const rows = rowsOf(block);
      const variationRow = rows.find((r) => norm(r[0]) === 'variation' && r[1]);
      const paths = rows.filter((r) => r !== variationRow).flatMap((r) => r.join('\n').split(/\s+/));
      paths.forEach((p) => add(p, variationRow?.[1], i, 'block'));
    });
  });
  return out;
}

/** DA config JSON (multi-sheet) → { settings, models } */
export function readConfig(json) {
  const sheet = (name) => (json?.[name]?.data || (json?.[':names'] ? [] : json?.data) || []);
  const settings = {};
  sheet('content-fragments').forEach((r) => {
    const k = norm(r.key || r.Key);
    if (k) settings[k] = String(r.value ?? r.Value ?? '').trim();
  });
  const models = sheet('content-fragment-models').map((r) => ({
    model: String(r.model || r.Model || '').trim(),
    template: String(r.template || r.Template || '').trim(),
    // the template itself, as the setup wizard saves it (instead of a template file)
    html: String(r.html || r.HTML || '').trim(),
    label: String(r.label || r.Label || '').trim(),
  })).filter((m) => m.model);
  return { settings, models };
}
