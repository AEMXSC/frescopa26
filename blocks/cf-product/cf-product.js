/**
 * Product card for a Frescopa Product Content Fragment (the design of AEM's "Frescopa product
 * card" template for the model). Rendered from the fragment by the Content Fragments panel with
 * tools/content-fragments/templates/frescopa-product.html.
 *
 * Authoring model, one cell per row except the facts:
 *   - eyebrow (p), name (h2), meta (p)
 *   - hero picture (optional)
 *   - description (p)
 *   - facts: one cell per fact, each a label (p) and a value (p)
 * Rows are matched by content, so a missing image row is fine.
 */
const filled = (cell) => cell.textContent.trim() || cell.querySelector('picture, img');

export default function decorate(block) {
  const rows = [...block.children];
  rows.forEach((row, i) => {
    // the DA editor pads short rows with empty cells to square the table: drop them
    [...row.children].forEach((cell) => { if (!filled(cell)) cell.remove(); });
    const cells = [...row.children];
    if (row.querySelector('picture')) {
      row.className = 'cf-product-hero';
    } else if (cells.length > 1) {
      row.className = 'cf-product-facts';
      cells.forEach((cell) => {
        const [label, value] = cell.querySelectorAll('p');
        if (label) label.className = 'cf-product-fact-label';
        if (value) value.className = 'cf-product-fact-value';
      });
    } else if (i === 0) {
      row.className = 'cf-product-head';
      const [eyebrow, , meta] = cells[0]?.children || [];
      if (eyebrow?.tagName === 'P') eyebrow.className = 'cf-product-eyebrow';
      if (meta?.tagName === 'P') meta.className = 'cf-product-meta';
    } else {
      row.className = 'cf-product-desc';
    }
  });
}
