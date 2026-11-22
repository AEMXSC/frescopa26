/*
 * cf-render: a Mustache subset for Content Fragment templates, dependency-free (EDS has no
 * runtime dependencies). One renderer for the Experience Workspace preview and the static
 * delivery, so the two cannot drift.
 *
 *   {{name}}            escaped value (dotted paths: {{cta.label}}; {{.}} is the current item)
 *   {{{name}}}          raw value (rich-text fields)
 *   {{#name}}…{{/name}} section: once if truthy, per item if an array (item fields in scope)
 *   {{^name}}…{{/name}} inverted section: when falsy or empty
 *   {{! comment }}
 * Data for a fragment: its fields by name (single values unwrapped, multi values as arrays), plus
 * `_path`, `_variation`, `_title`.
 */

// templates quote attributes with double quotes, so an apostrophe needs no escaping
const ESC = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c]);
const NAME = /^(?:\.|[\w-]+(?:\.[\w-]+)*)$/;

function check(name) {
  if (!NAME.test(name)) throw new Error(`Invalid tag name "${name}".`);
  return name;
}

/** the tag opening at `open`: { token (null for a comment), end } */
function readTag(tpl, open) {
  const raw = tpl[open + 2] === '{';
  const width = raw ? 3 : 2;
  const close = tpl.indexOf(raw ? '}}}' : '}}', open + 2);
  if (close < 0) throw new Error('Unclosed tag in template.');
  const inner = tpl.slice(open + width, close).trim();
  const end = close + width;
  if (raw) return { token: { t: 'raw', name: check(inner) }, end };
  if (inner[0] === '!') return { token: null, end };
  if (['#', '^', '/'].includes(inner[0])) return { token: { t: inner[0], name: check(inner.slice(1).trim()) }, end };
  return { token: { t: 'var', name: check(inner) }, end };
}

/** template → tokens: { t: 'text', v } | { t: 'var'|'raw'|'#'|'^'|'/', name } */
function tokenize(tpl) {
  const tokens = [];
  let pos = 0;
  let open = tpl.indexOf('{{');
  while (open >= 0) {
    if (open > pos) tokens.push({ t: 'text', v: tpl.slice(pos, open) });
    const { token, end } = readTag(tpl, open);
    if (token) tokens.push(token);
    pos = end;
    open = tpl.indexOf('{{', pos);
  }
  if (pos < tpl.length) tokens.push({ t: 'text', v: tpl.slice(pos) });
  return tokens;
}

/** tokens → tree: sections hold their children */
function parse(tokens) {
  const root = { kids: [] };
  const stack = [root];
  tokens.forEach((tok) => {
    const top = stack[stack.length - 1];
    if (tok.t === '#' || tok.t === '^') {
      const node = { ...tok, kids: [] };
      top.kids.push(node);
      stack.push(node);
    } else if (tok.t === '/') {
      if (stack.length < 2 || top.name !== tok.name) throw new Error(`Unexpected {{/${tok.name}}}.`);
      stack.pop();
    } else top.kids.push(tok);
  });
  if (stack.length > 1) throw new Error(`Unclosed section {{#${stack[stack.length - 1].name}}}.`);
  return root.kids;
}

function lookup(scopes, name) {
  if (name === '.') return scopes[scopes.length - 1];
  const [head, ...rest] = name.split('.');
  const scope = [...scopes].reverse().find((s) => s && typeof s === 'object' && head in s);
  if (!scope) return undefined;
  return rest.reduce((v, p) => (v == null ? undefined : v[p]), scope[head]);
}

const isEmpty = (v) => !v || (Array.isArray(v) && !v.length);
const text = (v) => (Array.isArray(v) ? v.join(', ') : v);

function emit(nodes, scopes) {
  return nodes.map((n) => {
    if (n.t === 'text') return n.v;
    const v = lookup(scopes, n.name);
    if (n.t === 'raw') return String(v ?? '');
    if (n.t === 'var') return esc(text(v));
    if (n.t === '^') return isEmpty(v) ? emit(n.kids, scopes) : '';
    if (isEmpty(v)) return '';
    const items = Array.isArray(v) ? v : [v];
    return items.map((item) => emit(n.kids, [...scopes, item])).join('');
  }).join('');
}

export function render(template, data) {
  return emit(parse(tokenize(String(template))), [data || {}]);
}

// a root-relative fragment link: the site's redirect for its path when it has one (a page already
// moved to this site), else the link base (the origin that still serves it); query and hash kept
function resolveLink(u, base, redirects) {
  if (typeof u !== 'string' || !u.startsWith('/') || u.startsWith('//')) return u;
  const cut = u.search(/[?#]/);
  const p = cut < 0 ? u : u.slice(0, cut);
  const to = redirects?.[p] ?? redirects?.[p.replace(/\/$/, '')];
  if (to) return `${to}${cut < 0 ? '' : u.slice(cut)}`;
  return base ? `${base}${u}` : u;
}

// "Label: /path. Label: /path." in a text field → [{ label, href }];
// [] unless every sentence is one
function labelledLinks(value) {
  const parts = value.split('. ').map((s) => s.trim().replace(/\.$/, '')).filter(Boolean);
  const links = parts.map((p) => {
    const at = p.indexOf(': /');
    return at > 0 && !p.slice(at + 2).includes(' ') ? { label: p.slice(0, at).trim(), href: p.slice(at + 2) } : null;
  });
  return links.length >= 2 && links.every(Boolean) ? links : [];
}

/**
 * Management API fragment (or variation) → template data.
 * - single values unwrapped, multi values kept as arrays;
 * - `assetBase` (the AEM publish origin) prefixes /content/dam/ values of content-reference fields;
 * - `linkBase` (site config `link-base`, e.g. https://www.example.com) prefixes root-relative
 *   values of fields whose name ends in `url`/`Url`/`href`, unless `redirects` (the site's
 *   /redirects.json as { source: destination }) maps the path, then the destination is used;
 * - a text field written as labelled links also gets `<name>_links` ([{ label, href }]) and
 *   `<name>_haslinks`, so a template can render a link list instead of the raw text.
 */
export function fragmentData(fragment, {
  path, variation, linkBase = '', redirects = null, assetBase = '',
} = {}) {
  const data = { _path: path || fragment?.path || '', _variation: variation || 'master', _title: fragment?.title || '' };
  // an asset reference (/content/dam/...) as a URL the page can load, e.g. from AEM publish
  const asset = (v) => (assetBase && typeof v === 'string' && v.startsWith('/content/dam/') ? `${assetBase}${v}` : v);
  (fragment?.fields || []).forEach((f) => {
    const values = Array.isArray(f.values) ? f.values : [];
    const value = f.multiple ? values : values[0] ?? '';
    if (f.type === 'content-reference') data[f.name] = Array.isArray(value) ? value.map(asset) : asset(value);
    else data[f.name] = /(url|href)$/i.test(f.name) ? resolveLink(value, linkBase, redirects) : value;
    if (typeof value === 'string') {
      const links = labelledLinks(value)
        .map((l) => ({ ...l, href: resolveLink(l.href, linkBase, redirects) }));
      if (links.length) {
        data[`${f.name}_links`] = links;
        data[`${f.name}_haslinks`] = true;
      }
    }
  });
  return data;
}

export default render;
