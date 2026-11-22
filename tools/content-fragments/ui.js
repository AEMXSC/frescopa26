/** el('button', { type: 'button', text: 'Go', onclick }, ...children) */
export default function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'text') n.textContent = v;
    else if (k === 'value') n.value = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  });
  kids.flat().filter(Boolean).forEach((k) => n.append(k));
  return n;
}

const SVG = 'http://www.w3.org/2000/svg';
const ICONS = new URL('./img/icons/', import.meta.url).href;

/** an S2 workflow icon (img/icons/s2-icon-<name>-20-n.svg), decorative */
export function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `${ICONS}s2-icon-${name}-20-n.svg#icon`);
  svg.append(use);
  const span = document.createElement('span');
  span.className = 'icon';
  span.append(svg);
  return span;
}
