/*
 * Keeps one fragment reference on the page in step with AEM, while the panel is open. AEM author
 * is the source of truth; the page holds a copy of the fragment's text. For each reference:
 *   - it says when the page's block shows other text than AEM has;
 *   - when the author types into that block (the block's text changes between two snapshots of
 *     the editor's document), the fields that can be read back are saved to AEM a few seconds
 *     later, as Universal Editor saves an in-place edit. Text that cannot be read back is
 *     reported, never guessed.
 * When the page already differed before the panel opened, nobody knows which side is newer, so
 * it asks (`saveFromPage` or the editor's Apply).
 */
import { findBlock, differsFromPage } from './apply.js';
import { fieldMap, valuesFromBlock } from './writeback.js';
import { fieldPatch } from './broker.js';

const DELAY = 3000;
const textOf = (html, ref) => {
  const found = html ? findBlock(html, ref) : null;
  return found ? found.block.textContent.replace(/\s+/g, ' ').trim() : null;
};

/**
 * @param {object} svc panel services (broker, live, onLive, template, rendered)
 * @param {object} ref { path, variation }
 * @param {object} fragment { id, model }
 * @param {object} ui { show(state, detail), busy() → true while the row's editor has unsaved edits, saved() }
 * states: 'same' | 'differs' | 'saving' | 'saved' | 'partial' | 'error'
 */
export default function watchRow(svc, ref, fragment, ui) {
  let snapshot;
  let tpl;
  let map;
  let last; // the block's text in the previous editor snapshot
  let timer;
  let saving = false;
  let labelOf = (name) => name; // field name → the model's label, once loaded

  const renderData = (data) => svc.rendered(tpl, data, ref);
  const differs = () => {
    const html = svc.live()?.html;
    if (!tpl || !snapshot || !html) return null;
    return differsFromPage(html, ref, renderData(snapshot.data));
  };
  const show = () => {
    const d = differs();
    if (d === null) return;
    ui.show(d ? 'differs' : 'same');
  };

  /** read the page's block back into fields and save them to AEM */
  async function saveFromPage() {
    if (!map || saving) return;
    saving = true;
    try {
      // an Apply right after a panel save can arrive before this row has AEM's new content
      snapshot = await svc.broker.get(fragment.id, ref.variation);
      const found = findBlock(svc.live()?.html || '', ref);
      if (!found || !differs()) { show(); return; }
      const aemBlock = new DOMParser().parseFromString(renderData(snapshot.data), 'text/html').body.firstElementChild;
      const { changes, unmappable } = valuesFromBlock(map, found.block, snapshot.data.fields, aemBlock);
      const skipped = unmappable.map(labelOf);
      if (!Object.keys(changes).length) { ui.show('partial', skipped); return; }
      ui.show('saving');
      await svc.broker.patch(fragment.id, ref.variation, snapshot.etag, fieldPatch(snapshot.data.fields, changes));
      snapshot = await svc.broker.get(fragment.id, ref.variation);
      ui.saved();
      if (differs()) ui.show('partial', skipped); else ui.show('saved');
    } catch (e) {
      ui.show('error', e.message);
    } finally {
      saving = false;
    }
  }

  function onLive() {
    const text = textOf(svc.live()?.html, ref);
    const edited = text !== null && last !== undefined && text !== last;
    last = text;
    if (!snapshot) return;
    show();
    if (!edited || !differs()) return; // unchanged, or changed to match AEM (an Apply)
    clearTimeout(timer);
    if (ui.busy()) { ui.show('differs'); return; } // the author is editing this fragment in the panel
    timer = setTimeout(saveFromPage, DELAY);
  }

  async function start() {
    const model = fragment.model?.id ? svc.broker.model(fragment.model.id).catch(() => null) : null;
    [snapshot, tpl] = await Promise.all([svc.broker.get(fragment.id, ref.variation), svc.template(fragment)]);
    const names = new Map(((await model)?.fields || []).map((f) => [f.name, f.label || f.name]));
    labelOf = (name) => names.get(name) || name;
    if (!tpl) return;
    map = fieldMap(renderData, snapshot.data.fields);
    last = textOf(svc.live()?.html, ref);
    show();
    svc.onLive(onLive);
  }

  return {
    start: () => start().catch(() => {}), // the row's own status light reports AEM errors
    saveFromPage,
    /** after the editor saved: AEM changed, take its new content */
    reload: async () => { snapshot = await svc.broker.get(fragment.id, ref.variation); show(); },
  };
}
