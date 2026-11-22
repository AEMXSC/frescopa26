/*
 * Client for the da-content-fragments broker (App Builder action). The panel never calls AEM
 * author itself: author refuses browser calls from da.live / *.aem.page without a per-environment
 * CORS policy; the broker calls it server to server with this same user token.
 */

export default function createBroker({ url, author, getToken }) {
  // <ns>.adobeioruntime.net/api/v1/web/<package>/<action> (or .../web/<ns>/<package>/<action>)
  if (!/^https:\/\/[a-z0-9.-]+\/api\/v1\/web(?:\/[\w.-]+){2,3}$/.test(url || '')) {
    throw new Error('Set `broker` in the content-fragments config sheet to the deployed action URL.');
  }
  if (!/^author-p\d+-e\d+\.adobeaemcloud\.com$/.test(author || '')) {
    throw new Error('Set `author` in the content-fragments config sheet (author-pXXX-eYYY.adobeaemcloud.com).');
  }
  const call = async (op, body = {}) => {
    const token = getToken();
    if (!token) throw new Error('Sign in to DA and reopen this panel.');
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, author, ...body }),
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON error page */ }
    if (!res.ok) {
      const e = new Error(json?.error || `Could not reach AEM through the broker (HTTP ${res.status}). Try again in a moment.`);
      e.status = res.status;
      throw e;
    }
    return json;
  };
  return {
    author,
    byPath: async (path) => (await call('list', { path, limit: 1 })).data?.items?.find((f) => f.path === path) || null,
    list: async (path, limit = 50) => (await call('list', { path, limit })).data?.items || [],
    /**
     * Every fragment under `path` (subfolders included) as summaries, up to `pages` × 50:
     * { items, more } where `more` means the folder holds more than was read
     */
    scan: async (path, pages = 20) => {
      const items = [];
      let cursor;
      for (let i = 0; i < pages; i += 1) {
        // each page needs the previous cursor
        const { data } = await call('list', {
          path, limit: 50, cursor, projection: 'summary',
        });
        items.push(...(data?.items || []));
        cursor = data?.cursor;
        if (!cursor) break;
      }
      return { items, more: !!cursor };
    },
    /** DAM folders directly under `path` ([{ path, title }]), up to `pages` × 50 */
    folders: async (path = '/content/dam', pages = 6) => {
      const out = [];
      let cursor;
      for (let i = 0; i < pages; i += 1) {
        // each page needs the previous cursor
        const { data } = await call('folders', { path, cursor });
        (data?.children || []).filter((c) => c.type === 'FOLDER').forEach((c) => out.push({ path: c.path, title: c.title || c.name }));
        cursor = data?.cursor;
        if (!cursor) break;
      }
      return out;
    },
    get: (id, variation) => call('get', { id, variation }),
    variations: async (id) => (await call('variations', { id })).data?.items || [],
    model: async (model) => (await call('model', { model })).data,
    patch: (id, variation, etag, ops) => call('patch', {
      id, variation, etag, ops,
    }),
  };
}

/** test + replace per changed single-value field, as Fréscopa's editor does */
export function fieldPatch(fields, changes) {
  const ops = [];
  Object.entries(changes).forEach(([name, value]) => {
    const index = fields.findIndex((f) => f.name === name);
    if (index < 0) return;
    if ((fields[index].values?.[0] ?? '') === value) return;
    ops.push({ op: 'test', path: `/fields/${index}/name`, value: name }, { op: 'replace', path: `/fields/${index}/values`, value: [value] });
  });
  return ops;
}

export const editable = (field) => !field.locked && !field.multiple
  && ['text', 'long-text'].includes(field.type)
  && (field.values || []).length <= 1 && (field.values || []).every((v) => typeof v === 'string');

/**
 * Status light from the master fragment: published, published with changes, or not published.
 * Not published is a state, not a failure: neutral, so red stays for errors.
 */
export function statusOf(fragment) {
  const s = String(fragment?.status || '').toUpperCase();
  if (s === 'PUBLISHED') return { tone: 'ok', label: 'Published' };
  if (s === 'MODIFIED') return { tone: 'warn', label: 'Changes not published' };
  if (s === 'UNPUBLISHED' || s === 'DRAFT' || s === 'NEW') return { tone: 'neutral', label: 'Not published' };
  return { tone: 'unknown', label: s ? `Status: ${s.toLowerCase()}` : 'Publication unknown' };
}
