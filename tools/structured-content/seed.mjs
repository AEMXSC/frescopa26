#!/usr/bin/env node
/* eslint-disable no-console, no-restricted-syntax, no-await-in-loop -- sequential Node CLI */
/**
 * Seed the "roast" structured content example into DA for aemxsc/frescopa26.
 *
 *   1. Save the JSON Schema to /.da/forms/schemas/roast.html (Schema Editor format)
 *   2. PUT each record to the Structured Content API source tier
 *   3. POST each record to preview + publish (and reindex) via the SC API
 *   4. Create the /our-roasts landing page with a roast-list block, preview + publish it
 *   5. Rebuild the preview and live query indexes
 *
 * Auth: an Adobe IMS token, from DA_TOKEN or ~/.aem/da-token.json
 *   (refresh with: npx github:adobe-rnd/da-auth-helper token)
 *
 * Usage: node tools/structured-content/seed.mjs [--dry-run] [--no-publish]
 */
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORG = 'aemxsc';
const SITE = 'frescopa26';
const SCHEMA = 'roast';
const FOLDER = 'roasts';
const LANDING = 'our-roasts';
const SC_API = 'https://sc-api.adobeaem.workers.dev';
const DA_ADMIN = 'https://admin.da.live';
const HLX_ADMIN = 'https://admin.hlx.page';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../structured-content');
const DRY_RUN = process.argv.includes('--dry-run');
const PUBLISH = !process.argv.includes('--no-publish');

async function loadToken() {
  if (process.env.DA_TOKEN) return process.env.DA_TOKEN;
  try {
    const cached = JSON.parse(await readFile(join(homedir(), '.aem/da-token.json'), 'utf8'));
    const token = cached.access_token || cached.token;
    if (token) return token;
  } catch { /* fall through */ }
  throw new Error('No IMS token. Set DA_TOKEN or run: npx github:adobe-rnd/da-auth-helper token');
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function call(label, url, opts) {
  if (DRY_RUN) {
    console.log(`[dry-run] ${opts.method} ${url}  (${label})`);
    return null;
  }
  const resp = await fetch(url, opts);
  const detail = resp.ok ? '' : ` ${resp.headers.get('x-error') || (await resp.text()).slice(0, 200)}`;
  console.log(`${resp.ok ? 'ok  ' : 'FAIL'} ${resp.status} ${label}${detail}`);
  if (resp.status === 401) throw new Error('401 Unauthorized: the IMS token expired. Refresh it and rerun.');
  return resp;
}

function daSourceForm(html) {
  const body = new FormData();
  body.append('data', new Blob([html], { type: 'text/html' }));
  return body;
}

async function saveSchema(auth) {
  const json = await readFile(join(ROOT, `${SCHEMA}.schema.json`), 'utf8');
  JSON.parse(json); // fail fast on malformed schema
  const html = `<body><header></header><main><div><pre><code>${escapeHtml(json.trim())}</code></pre></div></main><footer></footer></body>`;
  await call(`schema ${SCHEMA}`, `${DA_ADMIN}/source/${ORG}/${SITE}/.da/forms/schemas/${SCHEMA}.html`, {
    method: 'POST', headers: auth, body: daSourceForm(html),
  });
}

async function seedRecords(auth) {
  const dir = join(ROOT, FOLDER);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const doc = JSON.parse(await readFile(join(dir, file), 'utf8'));
    if (doc?.metadata?.schemaName !== SCHEMA) throw new Error(`${file}: metadata.schemaName must be "${SCHEMA}"`);
    const url = `${SC_API}/source/${ORG}/${SITE}/${FOLDER}/${basename(file)}`;
    await call(`put ${FOLDER}/${file}`, url, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(doc),
    });
    if (PUBLISH) await call(`publish ${FOLDER}/${file}`, url, { method: 'POST', headers: auth });
  }
}

async function seedLanding(auth) {
  const html = `<body><header></header><main>
<div><h1>Our roasts</h1><p>Every bag is roasted to order and tuned for the Atelier.</p>
<div class="roast-list"><div><div><p>limit</p></div><div><p>12</p></div></div></div></div>
<div><h2>Light and bright</h2>
<div class="roast-list"><div><div><p>roast level</p></div><div><p>Light</p></div></div></div></div>
</main><footer></footer></body>`;
  await call(`page /${LANDING}`, `${DA_ADMIN}/source/${ORG}/${SITE}/${LANDING}.html`, {
    method: 'POST', headers: auth, body: daSourceForm(html),
  });
  if (!PUBLISH) return;
  // DA-backed sites need the IMS token as both admin auth and content-source auth.
  const hlxAuth = { ...auth, 'x-content-source-authorization': auth.Authorization };
  for (const tier of ['preview', 'live']) {
    await call(`${tier} /${LANDING}`, `${HLX_ADMIN}/${tier}/${ORG}/${SITE}/main/${LANDING}`, { method: 'POST', headers: hlxAuth });
  }
}

async function rebuildIndexes(auth) {
  for (const tier of ['preview', 'live']) {
    await call(`rebuild ${tier} query.json`, `${SC_API}/${tier}/${ORG}/${SITE}/query.json`, { method: 'POST', headers: auth });
  }
}

async function main() {
  const auth = { Authorization: `Bearer ${DRY_RUN ? 'dry-run' : await loadToken()}` };
  await saveSchema(auth);
  await seedRecords(auth);
  await seedLanding(auth);
  if (PUBLISH) await rebuildIndexes(auth);
  console.log(`\nList page: https://main--${SITE}--${ORG}.aem.page/${LANDING}`);
  console.log(`Record:    https://main--${SITE}--${ORG}.aem.page/${FOLDER}/morning-ritual`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
