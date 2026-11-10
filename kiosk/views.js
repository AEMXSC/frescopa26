/**
 * Kiosk views — pure DOM builders. Each takes (state, actions) and returns an
 * element; kiosk.js owns state and re-renders. No innerHTML anywhere, since
 * content comes from an external API.
 */

export const GRINDS = ['Whole bean', 'Espresso', 'Filter'];
const LEVELS = ['All', 'Light', 'Medium', 'Dark'];

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v === undefined || v === null || v === false) return;
    if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  });
  children.flat().filter((c) => c !== null && c !== undefined && c !== false)
    .forEach((c) => node.append(c instanceof Node ? c : String(c)));
  return node;
}

export const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

export function imageSrc(url, width = 750) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (/\/media_[0-9a-f]+\.(jpe?g|png|webp)$/i.test(u.pathname)) {
      // EDS media is served by every branch host: load it same-origin so the
      // service worker can cache it for offline use.
      const query = new URLSearchParams({ width, format: 'webply', optimize: 'medium' });
      return `${u.pathname}?${query}`;
    }
    return u.href;
  } catch {
    return '';
  }
}

function productImage(p, cls, width) {
  return p.image
    ? h('img', {
      class: cls, src: imageSrc(p.image, width), alt: p.imageAlt, draggable: 'false',
    })
    : h('div', { class: `${cls} ph roast-${p.roastLevel.toLowerCase()}` }, h('span', {}, `${p.roastLevel} roast`));
}

const logo = (dark) => h('img', {
  class: 'logo', alt: 'Fréscopa', src: dark ? '/icons/frescopa-logo-light.svg' : '/media/frescopa-logo.svg',
});

export function attractView(state, a) {
  const slides = (state.products.filter((p) => p.featured && p.image).length
    ? state.products.filter((p) => p.featured && p.image)
    : state.products.filter((p) => p.image));
  const slide = slides.length ? slides[state.slide % slides.length] : null;
  return h(
    'section',
    { class: 'view attract', onClick: a.start },
    slide && h('img', { class: 'attract-bg', src: imageSrc(slide.image, 1200), alt: '' }),
    h('div', { class: 'attract-shade' }),
    h('header', { class: 'attract-top' }, logo(true)),
    h(
      'div',
      { class: 'attract-copy' },
      slide && h('p', { class: 'eyebrow' }, slide.featured ? 'Most loved' : slide.origin),
      slide && h('h1', {}, slide.name),
      slide && h('p', { class: 'attract-notes' }, slide.notes.join(' · ')),
    ),
    h('button', { class: 'attract-cta', type: 'button' }, 'Touch to order'),
  );
}

function header(a, title) {
  return h(
    'header',
    { class: 'bar' },
    logo(false),
    h('h2', { class: 'bar-title' }, title),
    h('button', { class: 'ghost', type: 'button', onClick: a.reset }, 'Start over'),
  );
}

function cartBar(state, a) {
  const count = state.cart.reduce((n, l) => n + l.qty, 0);
  if (!count) return null;
  return h(
    'button',
    { class: 'cart-bar', type: 'button', onClick: () => a.go('cart') },
    h('span', { class: 'cart-count' }, String(count)),
    h('span', {}, 'Review order'),
    h('span', { class: 'cart-total' }, money(a.total())),
  );
}

export function menuView(state, a) {
  const list = state.filter === 'All'
    ? state.products : state.products.filter((p) => p.roastLevel === state.filter);
  return h(
    'section',
    { class: 'view menu' },
    header(a, 'Choose your roast'),
    h('nav', { class: 'chips', 'aria-label': 'Roast level' }, LEVELS.map((l) => h('button', {
      type: 'button', class: `chip${state.filter === l ? ' on' : ''}`, 'aria-pressed': String(state.filter === l), onClick: () => a.filter(l),
    }, l))),
    h('div', { class: 'grid' }, list.map((p) => h(
      'button',
      { type: 'button', class: `tile${state.flash.has(p.id) ? ' flash' : ''}`, onClick: () => a.open(p.id) },
      productImage(p, 'tile-img', 600),
      p.featured && h('span', { class: 'badge' }, 'Most loved'),
      h('span', { class: 'tile-origin' }, p.origin),
      h('span', { class: 'tile-name' }, p.name),
      h('span', { class: 'tile-price' }, money(p.price)),
    ))),
    !list.length && h('p', { class: 'empty' }, 'Nothing here right now. Try another roast level.'),
    cartBar(state, a),
  );
}

export function productView(state, a) {
  const p = state.products.find((x) => x.id === state.current);
  if (!p) return menuView(state, a);
  const { grind, qty } = state.draft;
  return h(
    'section',
    { class: 'view product' },
    header(a, ''),
    h('button', { class: 'back', type: 'button', onClick: () => a.go('menu') }, '← All roasts'),
    productImage(p, 'hero-img', 1200),
    h(
      'div',
      { class: `product-body${state.flash.has(p.id) ? ' flash' : ''}` },
      h('p', { class: 'eyebrow' }, `${p.origin} · ${p.roastLevel} roast`),
      h('h1', {}, p.name),
      h('ul', { class: 'notes' }, p.notes.map((n) => h('li', {}, n))),
      h('p', { class: 'desc' }, p.description),
      h('p', { class: 'label' }, 'Grind'),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Grind' }, GRINDS.map((g) => h('button', {
        type: 'button', class: grind === g ? 'on' : '', 'aria-pressed': String(grind === g), onClick: () => a.draft({ grind: g }),
      }, g))),
      h(
        'div',
        { class: 'buy' },
        h(
          'div',
          { class: 'stepper' },
          h('button', { type: 'button', 'aria-label': 'Fewer', onClick: () => a.draft({ qty: Math.max(1, qty - 1) }) }, '−'),
          h('span', {}, String(qty)),
          h('button', { type: 'button', 'aria-label': 'More', onClick: () => a.draft({ qty: Math.min(9, qty + 1) }) }, '+'),
        ),
        h('button', { class: 'primary', type: 'button', onClick: a.add }, `Add to order · ${money(p.price * qty)}`),
      ),
      h('p', { class: 'fine' }, `${p.bagSize || '250g'} bag, roasted this week`),
    ),
  );
}

export function cartView(state, a) {
  const lines = state.cart.map((l) => ({ ...l, p: state.products.find((x) => x.id === l.id) }))
    .filter((l) => l.p);
  return h(
    'section',
    { class: 'view cart' },
    header(a, 'Your order'),
    h('ul', { class: 'lines' }, lines.map((l) => h(
      'li',
      { class: `line${state.flash.has(l.id) ? ' flash' : ''}` },
      productImage(l.p, 'line-img', 300),
      h('div', { class: 'line-info' }, h('strong', {}, l.p.name), h('span', {}, `${l.grind} · ${money(l.p.price)}`)),
      h(
        'div',
        { class: 'stepper small' },
        h('button', { type: 'button', 'aria-label': 'Fewer', onClick: () => a.qty(l.key, l.qty - 1) }, '−'),
        h('span', {}, String(l.qty)),
        h('button', { type: 'button', 'aria-label': 'More', onClick: () => a.qty(l.key, l.qty + 1) }, '+'),
      ),
      h('span', { class: 'line-total' }, money(l.p.price * l.qty)),
    ))),
    !lines.length && h('p', { class: 'empty' }, 'Your order is empty.'),
    h('div', { class: 'totals' }, h('span', {}, 'Total'), h('strong', {}, money(a.total()))),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'ghost big', type: 'button', onClick: () => a.go('menu') }, 'Add more'),
      h('button', {
        class: 'primary big', type: 'button', disabled: !lines.length, onClick: a.checkout,
      }, 'Checkout'),
    ),
  );
}

export function payView(state, a) {
  const qr = h('div', { class: 'qr', 'aria-label': 'QR code to pay on your phone' });
  if (window.QRCode) {
    // eslint-disable-next-line no-new
    new window.QRCode(qr, {
      text: state.payUrl, width: 360, height: 360, colorDark: '#2b2118', colorLight: '#ffffff',
    });
  }
  return h(
    'section',
    { class: 'view pay' },
    header(a, 'Pay'),
    h('h1', {}, money(a.total())),
    h('p', { class: 'lead' }, 'Scan to pay on your phone'),
    qr,
    h('p', { class: 'fine' }, 'Apple Pay, Google Pay or your Fréscopa app. Your order follows you.'),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'ghost big', type: 'button', onClick: a.payCounter }, 'Pay at the counter'),
      h('button', { class: 'primary big', type: 'button', onClick: a.paid }, 'I’ve paid'),
    ),
  );
}

export function doneView(state, a) {
  return h(
    'section',
    { class: 'view done', onClick: a.reset },
    logo(true),
    h('p', { class: 'eyebrow' }, state.paidAtCounter ? 'Pay at the counter' : 'Paid · thank you'),
    h('p', { class: 'order-no' }, state.orderNo),
    h('p', { class: 'lead' }, 'We’ll call your number when your coffee is bagged and ready.'),
  );
}

export function idleOverlay(seconds, a) {
  return h(
    'div',
    { class: 'idle', role: 'alertdialog', 'aria-label': 'Still ordering?' },
    h(
      'div',
      { class: 'idle-card' },
      h('h2', {}, 'Still ordering?'),
      h('p', {}, `Starting over in ${seconds}s`),
      h('button', { class: 'primary big', type: 'button', onClick: a.stay }, 'Yes, keep my order'),
    ),
  );
}

export function statusPill(state, a) {
  const ago = state.syncedAt ? Math.max(0, Math.round((Date.now() - state.syncedAt) / 1000)) : null;
  const text = state.syncError ? 'Offline · showing last menu' : `${state.tier} content · synced ${ago ?? '–'}s ago`;
  return h('button', {
    type: 'button', class: `status${state.syncError ? ' err' : ''}`, onClick: a.toggleJson, title: 'Show the JSON behind this screen',
  }, h('i', {}), text);
}

export function jsonDrawer(state, a, endpoint, payload) {
  return h(
    'aside',
    { class: 'json' },
    h(
      'div',
      { class: 'json-head' },
      h('strong', {}, 'Headless payload'),
      h('button', { type: 'button', class: 'ghost', onClick: a.toggleJson }, 'Close'),
    ),
    h('code', { class: 'json-url' }, `GET ${endpoint}`),
    h('pre', {}, JSON.stringify(payload, null, 2)),
  );
}

export function toast(text) {
  return h('div', { class: 'toast', role: 'status' }, text);
}
