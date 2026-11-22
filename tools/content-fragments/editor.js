/*
 * One fragment's editor, inside its row in the panel: fields, the live preview, and the way to
 * this page: 1. edit (the preview follows), 2. Save to AEM, 3. Apply to this page, 4. publish the
 * page. The steps are shown as a list with the current one marked, and each step has one primary
 * button. Messages for this fragment appear here, next to the buttons, not at the top of the panel.
 */
import { fieldPatch, editable } from './broker.js';
import { findBlock, applyToPage, differsFromPage } from './apply.js';
import el, { icon } from './ui.js';

const STEPS = [
  ['edit', 'Edit', 'The page preview follows as you type.'],
  ['save', 'Save to AEM', 'Updates the fragment on AEM author, for every page that uses it.'],
  ['apply', 'Apply to this page', 'Writes the new text into this page in the editor.'],
  ['publish', 'Publish', 'Puts the fragment on AEM publish and this page on the live site.'],
];

let rowSeq = 0;

function stepList() {
  const items = STEPS.map(([key, title, hint]) => el(
    'li',
    { 'data-step': key },
    el('span', { class: 'step-mark', 'aria-hidden': 'true' }),
    el('span', { class: 'step-text' }, el('strong', { text: title }), el('span', { text: hint })),
  ));
  const list = el('ol', { class: 'steps', 'aria-label': 'To update this page' }, items);
  const stateOf = (i, at) => {
    if (i < at) return 'done';
    return i === at ? 'current' : 'todo';
  };
  /** mark steps before `key` done, `key` current */
  const set = (key) => {
    const at = STEPS.findIndex(([k]) => k === key);
    items.forEach((li, i) => {
      li.dataset.state = stateOf(i, at);
      if (i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      li.querySelector('.step-mark').replaceChildren(i < at ? icon('checkmarkcircle') : String(i + 1));
    });
  };
  return { list, set };
}

const variationName = (v) => (v === 'master' ? 'Main' : v);

/** what Apply needs, from the editor's selection (true, false, or null: no editor document) */
function applyHintFor(sel, variation) {
  if (sel === null) return 'Open this page in the editor (Layout or Split view) to apply.';
  if (sel) return 'This block is selected in the editor.';
  return `Click inside this fragment's block (${variationName(variation)}) in the editor to apply.`;
}

/**
 * @param {object} ctx panel services: broker, sdk, live() (editor document), onLive(fn),
 *   post(msg), previewOn(), template(fragment), rendered(tpl, data, ref), editorUrl(id),
 *   previewPage()
 * @param {object} ref { path, variation }
 * @param {object} fragment the fragment (id, model)
 * @param {HTMLElement} host the row body
 * @param {object} row { dirty(bool), refresh() }
 */
export default async function openEditor(ctx, ref, fragment, host, row) {
  const { broker } = ctx;
  rowSeq += 1;
  const uid = `r${rowSeq}`;
  host.replaceChildren(el('p', { class: 'muted', text: 'Loading fields from AEM author…' }));
  const variations = [{ name: 'master', title: 'Main' }, ...await broker.variations(fragment.id)];
  let current = ref.variation;
  let snapshot;
  const drafts = new Map(); // unsaved edits per variation, kept when switching
  const draft = () => drafts.get(current) || {};
  let saved = false; // saved to AEM since the last Apply
  let applied = false; // applied to the page since the last Publish
  const tpl = await ctx.template(fragment).catch(() => null);
  const href = await ctx.editorUrl(fragment.id);
  // fragment fields carry names only; their labels ("Product name") are in the model
  const model = fragment.model?.id ? await broker.model(fragment.model.id).catch(() => null) : null;
  const labels = new Map((model?.fields || []).map((f) => [f.name, f.label]));

  const status = el('p', { class: 'row-status', role: 'status', 'aria-live': 'polite' });
  const tell = (msg = '', tone = '') => { status.textContent = msg; status.dataset.tone = tone; };
  const steps = stepList();
  const dirty = () => [...drafts.values()].some((d) => Object.keys(d).length);
  const renderWith = (d) => {
    const fields = snapshot.data.fields.map((f) => (f.name in d ? { ...f, values: [d[f.name]] } : f));
    return ctx.rendered(tpl, { ...snapshot.data, fields }, { ...ref, variation: current });
  };
  const render = () => renderWith(draft());
  /** does the open page show other text than AEM has? (null: no editor document or block) */
  const differs = () => {
    const live = ctx.live();
    if (!tpl || !snapshot || !live?.html) return null;
    try { return differsFromPage(live.html, { ...ref, variation: current }, renderWith({})); } catch { return null; }
  };
  const keepPage = el('button', {
    type: 'button', class: 'nx-action-btn', text: 'Save page text to AEM', onclick: () => row.saveFromPage?.(),
  });
  const driftNote = el(
    'div',
    { class: 'note warn', hidden: true },
    el('p', {
      text: 'This page shows different text than AEM has for this fragment: the page was edited directly, '
        + 'or AEM changed after the last Apply. Apply to page puts AEM\'s version on the page; '
        + 'Save page text to AEM keeps the page\'s.',
    }),
    keepPage,
  );

  let renderTimer;
  const preview = () => {
    if (!tpl) return;
    ctx.post({
      type: 'render', path: ref.path, variation: current, html: render(),
    });
    clearTimeout(renderTimer);
    if (!ctx.previewOn()) return; // the panel already says the live preview is off
    renderTimer = setTimeout(() => tell('The page preview did not answer. Reload the page preview to see edits as you type.', 'warn'), 4000);
  };
  ctx.onRendered?.(() => clearTimeout(renderTimer));

  const save = el('button', { type: 'button', class: 'nx-btn-accent', text: 'Save to AEM' });
  const apply = el('button', { type: 'button', class: 'nx-btn-accent', text: 'Apply to page' });
  const applyHint = el('p', { class: 'muted apply-hint' });
  const discard = el('button', { type: 'button', class: 'nx-action-btn-quiet', text: 'Discard changes' });
  const publish = el('button', {
    type: 'button', class: 'nx-btn-accent', text: 'Publish', hidden: true,
  });
  const open = el('a', {
    class: 'nx-action-btn', href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open in AEM (opens in a new tab)',
  }, icon('openin'), 'Open in AEM');

  /** is this fragment's block the one selected in the editor? */
  const selected = () => {
    const live = ctx.live();
    if (!live?.html) return null;
    const found = findBlock(live.html, { ...ref, variation: current });
    return found ? live.selection?.blockIndex === found.index : null;
  };

  // one primary button per step; the rest step back
  const update = () => {
    const changed = Object.keys(draft()).length > 0;
    row.dirty(dirty());
    save.disabled = !changed;
    discard.hidden = !changed;
    const out = !changed && differs() === true;
    driftNote.hidden = !out;
    const applying = (saved || out) && !changed && !!tpl;
    save.className = applying ? 'nx-action-btn' : 'nx-btn-accent';
    apply.hidden = !applying;
    applyHint.hidden = !applying;
    if (applying) {
      const sel = selected();
      apply.disabled = sel !== true;
      applyHint.textContent = applyHintFor(sel, current);
    }
    // Publish once the page shows what AEM has: right after an Apply, or whenever AEM has
    // unpublished changes the page already shows (e.g. page edits saved to AEM)
    const publishing = !changed && !applying && (applied || !!row.publishable?.());
    publish.hidden = !publishing;
    if (changed) steps.set('save');
    else if (applying) steps.set('apply');
    else if (publishing) steps.set('publish');
    else steps.set('edit');
  };
  ctx.onLive?.(() => { if (host.isConnected) update(); });

  const form = el('form', {
    class: 'fields',
    onsubmit: (e) => e.preventDefault(),
    onkeydown: (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!save.disabled) save.click(); }
    },
  });
  const notes = el('p', { class: 'muted' });

  function draw() {
    const d = draft();
    const readOnly = [];
    let timer;
    form.replaceChildren();
    snapshot.data.fields.forEach((f) => {
      const id = `${uid}-f-${f.name}`;
      const label = f.label || labels.get(f.name) || f.name;
      if (!editable(f)) {
        const value = Array.isArray(f.values) ? f.values.join(', ') : '';
        readOnly.push(label);
        form.append(el('p', { class: 'readonly' }, el('span', { class: 'label', text: label }), el('span', { text: value || '—' })));
        return;
      }
      const input = el(f.type === 'long-text' ? 'textarea' : 'input', {
        id, name: f.name, class: 'nx-input', rows: f.type === 'long-text' ? 4 : null,
        oninput: (e) => {
          drafts.set(current, { ...draft(), [f.name]: e.target.value });
          update();
          clearTimeout(timer);
          timer = setTimeout(preview, 350);
        },
      });
      input.value = f.name in d ? d[f.name] : (f.values?.[0] ?? '');
      form.append(el('label', { for: id, text: label }), input);
    });
    const tip = tpl ? 'Ctrl+S saves.' : 'This model has no template: the page preview does not follow edits.';
    notes.textContent = readOnly.length ? `${readOnly.join(', ')}: edit in AEM. ${tip}` : tip;
    update();
  }

  save.onclick = async () => {
    const ops = fieldPatch(snapshot.data.fields, draft());
    if (!ops.length) { tell('No changes to save.'); return; }
    save.disabled = true;
    tell('Saving to AEM…');
    try {
      const r = await broker.patch(fragment.id, current, snapshot.etag, ops);
      drafts.delete(current);
      snapshot = await broker.get(fragment.id, current); // fresh values and ETag
      if (r.etag && !snapshot.etag) snapshot.etag = r.etag;
      saved = true;
      draw();
      row.refresh();
      row.aemChanged?.();
      // one click: with the block selected in the editor, the page follows the save straight away
      if (tpl && selected() === true) { apply.onclick(); return; }
      tell(tpl ? `Saved to ${variationName(current)} on AEM author. Next: click inside its block in the editor and apply it to this page.`
        : `Saved to ${variationName(current)} on AEM author. This model has no template, so it cannot be applied here.`, 'ok');
    } catch (e) {
      tell(e.message, 'error');
      update();
    }
  };
  apply.onclick = async () => {
    apply.disabled = true;
    tell('Applying to the page…');
    try {
      await applyToPage({
        actions: ctx.sdk.actions, live: ctx.live(), ref: { ...ref, variation: current }, renderedHtml: render(), preview: ctx.previewPage,
      });
      saved = false;
      applied = true;
      save.className = 'nx-action-btn';
      update();
      tell('Applied to this page and previewed. Publish puts the fragment on AEM publish and this page on the live site.', 'ok');
    } catch (e) { tell(e.message, 'error'); apply.disabled = false; }
  };
  publish.onclick = async () => {
    publish.disabled = true;
    tell('Publishing the fragment in AEM, then this page…');
    try {
      await row.publish();
      applied = false;
      save.className = 'nx-btn-accent';
      update();
      tell('Published: the fragment on AEM publish, and this page on the live site.', 'ok');
    } catch (e) { tell(e.message, 'error'); } finally { publish.disabled = false; }
  };
  discard.onclick = () => { drafts.delete(current); draw(); preview(); tell('Changes discarded.'); };


  const vid = `${uid}-variation`;
  const select = el('select', {
    id: vid, class: 'nx-input',
    onchange: async (e) => {
      current = e.target.value;
      saved = false;
      tell(drafts.has(current) ? 'Your unsaved changes to this variation are kept.' : '');
      snapshot = await broker.get(fragment.id, current);
      draw();
      preview();
    },
  }, variations.map((v) => el('option', { value: v.name, selected: v.name === current, text: v.title || v.name })));

  snapshot = await broker.get(fragment.id, current);
  host.replaceChildren(
    el('div', { class: 'field' }, el('label', { for: vid, text: 'Variation' }), select),
    form,
    notes,
    driftNote,
    steps.list,
    el('div', { class: 'actions' }, save, apply, publish, discard, open),
    applyHint,
    status,
  );
  draw();
}
