/*
 * Adobe's AEM repository discovery for the signed-in user: which AEM Cloud Service authors this
 * account can reach, with readable names (program, environment) and the owning IMS org.
 */

const AUTHOR = /^author-p\d+-e\d+\.adobeaemcloud\.com$/;

const title = (r) => r?.['dc:title']?.['rdf:_1']?.['@value'] || r?.['aem:environmentTitle'] || r?.['repo:repositoryId'];

/** @returns {Promise<{ id, label, program, environment, org, hibernated }[]>} author tier only */
export async function listAuthors(token) {
  if (!token) throw new Error('Sign in to DA and reopen this panel.');
  const res = await fetch('https://aem-discovery.adobe.io/repositories', {
    credentials: 'omit', cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'x-api-key': 'exc_app' },
  });
  if (!res.ok) throw new Error(`AEM repository discovery returned HTTP ${res.status}.`);
  const json = await res.json();
  return (json?.children || [])
    .map((child) => {
      const { _embedded: embedded } = child || {};
      return embedded?.['http://ns.adobe.com/adobecloud/rel/primary'];
    })
    .filter((r) => AUTHOR.test(r?.['repo:repositoryId'] || ''))
    .map((r) => ({
      id: r['repo:repositoryId'],
      label: title(r),
      program: r['aem:programTitle'] || '',
      environment: r['aem:environment'] || '',
      org: r['repo:owner']?.type === 'org' ? r['repo:owner'].id : '',
      hibernated: r['aem:hibernated'] === true,
    }))
    .sort((a, b) => `${a.program} ${a.label}`.localeCompare(`${b.program} ${b.label}`));
}

/** the IMS org that owns an author repository */
export async function imsOrgFor(author, token) {
  const found = (await listAuthors(token)).find((a) => a.id === author);
  if (!/^[A-Za-z0-9]+@AdobeOrg$/.test(found?.org || '')) {
    throw new Error(`Your account cannot see ${author} in AEM repository discovery.`);
  }
  return found.org;
}
