/**
 * cf-card: the default layout for a Content Fragment placed without its own template (the
 * da-content-fragments starter template). One row: an optional image cell, then a text cell.
 * Authored nodes stay in place; only classes are added.
 * @param {Element} block The block element
 */
export default function decorate(block) {
  [...block.children].forEach((row) => {
    [...row.children].forEach((cell) => {
      const onlyPicture = cell.querySelector('picture') && !cell.textContent.trim();
      cell.classList.add(onlyPicture ? 'cf-card-image' : 'cf-card-text');
    });
  });
}
