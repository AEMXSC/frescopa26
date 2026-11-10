/**
 * Headless data layer for the Fréscopa kiosk. No EDS rendering involved:
 * everything comes from structured content JSON over HTTP.
 *
 *  - Catalogue membership: Structured Content API query index
 *    (https://www.aem.live/docs/ew/developing/structured-content-api)
 *  - Per-record freshness: da-sc delivery endpoint, which reads the published
 *    record directly, so a publish shows up even before the index catches up.
 */

const SC_API = 'https://sc-api.adobeaem.workers.dev';
const DA_SC = 'https://da-sc.adobeaem.workers.dev';
const ORG = 'aemxsc';
const SITE = 'frescopa26';
const SCHEMA = 'roast';

export function getTier() {
  const tier = new URLSearchParams(window.location.search).get('tier');
  return tier === 'preview' ? 'preview' : 'live';
}

export function queryUrl(tier = getTier()) {
  const url = new URL(`${SC_API}/${tier}/${ORG}/${SITE}/query.json`);
  url.searchParams.set('q', `schemaName:${SCHEMA}`);
  url.searchParams.set('limit', '200');
  return url.href;
}

export function recordUrl(path, tier = getTier()) {
  return `${DA_SC}/${tier}/${ORG}/${SITE}${path}`;
}

async function getJson(url) {
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) throw Object.assign(new Error(`${resp.status} from ${url}`), { status: resp.status });
  return resp.json();
}

/** Normalise one record into the shape the kiosk renders. */
export function toProduct(path, record) {
  const d = record?.data || {};
  const price = Number(d.price);
  if (!d.name || !Number.isFinite(price)) return null;
  return {
    id: path,
    path,
    name: d.name,
    origin: d.origin || '',
    roastLevel: d.roastLevel || '',
    notes: Array.isArray(d.tastingNotes) ? d.tastingNotes : [],
    description: d.description || '',
    image: typeof d.image === 'string' && d.image.startsWith('https://') ? d.image : '',
    imageAlt: d.imageAlt || d.name,
    price,
    bagSize: d.bagSize || '',
    featured: d.featured === true,
    raw: record,
  };
}

/**
 * Load the full catalogue. Each record is refreshed from da-sc; if that call
 * fails, the index copy is used so one bad record never blanks the menu.
 */
export async function loadCatalogue(tier = getTier()) {
  const index = await getJson(queryUrl(tier));
  const items = (index.data || []).filter((i) => i?.metadata?.schemaName === SCHEMA);
  const fresh = await Promise.all(items.map(async (item) => {
    try {
      return toProduct(item.path, await getJson(recordUrl(item.path, tier)));
    } catch (error) {
      // 404 = unpublished: drop it even if the index still lists it.
      return error.status === 404 ? null : toProduct(item.path, item);
    }
  }));
  return fresh
    .filter(Boolean)
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name));
}

/** Stable fingerprint of what the kiosk displays, for change detection. */
export function fingerprint(product) {
  const { raw, ...shown } = product;
  return JSON.stringify(shown);
}
