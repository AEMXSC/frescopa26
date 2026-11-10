/**
 * da-form — the metadata block Experience Workspace writes at the top of every
 * structured content record (x-schema-name, title). It is editor bookkeeping,
 * not page content, so it is removed from the rendered page.
 */
export default function decorate(block) {
  block.closest('.da-form-wrapper')?.remove();
  block.remove();
}
