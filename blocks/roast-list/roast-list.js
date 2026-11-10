import { buildNotes, formatPrice } from '../roast/roast.js';

/**
 * Roast list — a grid of "roast" structured content records, read live from
 * the Structured Content API query index
 * (https://www.aem.live/docs/ew/developing/structured-content-api).
 *
 * Authoring model (all rows optional, two cells each: key | value):
 *   | roast-list    |        |
 *   | roast level   | Light  |   filter: Light, Medium or Dark
 *   | featured only | true   |   only records with featured = true
 *   | limit         | 6      |   max cards (default 12)
 *
 * Tier: *.aem.live reads the "live" index; everything else (aem.page,
 * localhost) reads "preview", so authors see previewed records before publish.
 */

// Adobe notes this host may change — keep it in one place.
const SC_API = 'https://sc-api.adobeaem.workers.dev';
const SITE = { org: 'aemxsc', site: 'frescopa26' };
const SCHEMA = 'roast';
const DEFAULT_LIMIT = 12;

function readConfig(block) {
  const config = {};
  [...block.children].forEach((row) => {
    const [k, v] = row.children;
    if (k && v) config[k.textContent.trim().toLowerCase()] = v.textContent.trim();
  });
  const limit = Number.parseInt(config.limit, 10);
  return {
    roastLevel: config['roast level'] || '',
    featuredOnly: config['featured only'] === 'true',
    limit: Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT,
  };
}

export function buildQueryUrl({ roastLevel }, hostname = window.location.hostname) {
  const tier = hostname.endsWith('.aem.live') ? 'live' : 'preview';
  const url = new URL(`${SC_API}/${tier}/${SITE.org}/${SITE.site}/query.json`);
  // Terms are ANDed server-side. selectRoasts() re-checks the schema client-side.
  const terms = [`schemaName:${SCHEMA}`, roastLevel && `roastLevel:${roastLevel}`].filter(Boolean);
  url.searchParams.set('q', terms.join(' '));
  url.searchParams.set('limit', '200');
  return url;
}

export function selectRoasts(items, { featuredOnly, limit }) {
  return items
    .filter((item) => item?.metadata?.schemaName === SCHEMA && item.data?.name)
    .filter((item) => !featuredOnly || item.data.featured === true)
    .sort((a, b) => Number(b.data.featured === true) - Number(a.data.featured === true))
    .slice(0, limit);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function buildCard({ path, data }) {
  const card = el('a', 'roast-list-card');
  card.href = path;

  const level = String(data.roastLevel || '').toLowerCase();
  const media = el('div', `roast-list-media roast-level-${level || 'unknown'}`);
  media.append(el('span', 'roast-list-level', data.roastLevel ? `${data.roastLevel} roast` : 'Roast'));
  if (data.featured === true) media.append(el('span', 'roast-badge', 'Most loved'));

  const body = el('div', 'roast-list-body');
  if (data.origin) body.append(el('p', 'roast-origin', data.origin));
  body.append(el('h3', 'roast-list-name', data.name));
  if (data.tastingNotes?.length) body.append(buildNotes(data.tastingNotes));
  const price = formatPrice(data.price);
  if (price) body.append(el('p', 'roast-list-price', `${price}${data.bagSize ? ` · ${data.bagSize}` : ''}`));

  card.append(media, body);
  return card;
}

function showMessage(block, text) {
  block.textContent = '';
  block.append(el('p', 'roast-list-message', text));
}

export default async function decorate(block) {
  const config = readConfig(block);
  showMessage(block, 'Loading roasts…');

  let items;
  try {
    const resp = await fetch(buildQueryUrl(config));
    if (!resp.ok) throw new Error(`Structured Content API returned ${resp.status}`);
    ({ data: items = [] } = await resp.json());
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('roast-list: could not load roasts', error);
    showMessage(block, 'Our roasts are unavailable right now. Please try again shortly.');
    return;
  }

  const roasts = selectRoasts(items, config);
  if (!roasts.length) {
    showMessage(block, 'No roasts match this selection yet.');
    return;
  }

  const grid = el('div', 'roast-list-grid');
  roasts.forEach((roast) => grid.append(buildCard(roast)));
  block.textContent = '';
  block.append(grid);
}
