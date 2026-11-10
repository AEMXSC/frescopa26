/**
 * Fréscopa Roast Bar — touch ordering kiosk on headless structured content.
 * State lives here; views.js builds DOM. State is replaced, never mutated.
 *
 * URL params: ?tier=preview  read previewed (unpublished) content
 *             ?poll=15       seconds between content syncs (default 15)
 *             ?start=menu    skip the attract loop (presenter shortcut)
 */
/* eslint-disable no-use-before-define -- actions is defined once at load, used at call time */
import {
  loadCatalogue, fingerprint, getTier, queryUrl, recordUrl,
} from './data.js';
import {
  attractView, menuView, productView, cartView, payView, doneView,
  idleOverlay, statusPill, jsonDrawer, toast, GRINDS,
} from './views.js';

const params = new URLSearchParams(window.location.search);
const POLL_MS = Math.max(5, Number(params.get('poll')) || 15) * 1000;
const IDLE_MS = 45000;
const IDLE_COUNTDOWN = 10;
const SLIDE_MS = 5000;
const DONE_MS = 12000;
const SITE_URL = 'https://main--frescopa26--aemxsc.aem.live';
const STAGE = { w: 1080, h: 1920 };

const stage = document.getElementById('stage');

const initial = {
  tier: getTier(),
  products: [],
  view: params.get('start') === 'menu' ? 'menu' : 'attract',
  slide: 0,
  filter: 'All',
  current: null,
  draft: { grind: GRINDS[0], qty: 1 },
  cart: [],
  orderNo: '',
  payUrl: '',
  paidAtCounter: false,
  flash: new Set(),
  toast: '',
  showJson: false,
  idle: 0,
  syncedAt: 0,
  syncError: false,
};

let state = initial;
let lastTouch = Date.now();
let doneTimer;
let toastTimer;

function render() {
  const views = {
    attract: attractView,
    menu: menuView,
    product: productView,
    cart: cartView,
    pay: payView,
    done: doneView,
  };
  const view = (views[state.view] || menuView)(state, actions);
  const layers = [view, statusPill(state, actions)];
  if (state.showJson) {
    const p = state.products.find((x) => x.id === state.current);
    layers.push(p
      ? jsonDrawer(state, actions, recordUrl(p.path, state.tier), p.raw)
      : jsonDrawer(state, actions, queryUrl(state.tier), state.products.map((x) => x.raw)));
  }
  if (state.toast) layers.push(toast(state.toast));
  if (state.idle) layers.push(idleOverlay(state.idle, actions));
  stage.replaceChildren(...layers);
}

function setState(patch) {
  state = { ...state, ...patch };
  render();
}

const total = () => state.cart.reduce((sum, l) => {
  const p = state.products.find((x) => x.id === l.id);
  return p ? sum + p.price * l.qty : sum;
}, 0);

function showToast(text) {
  clearTimeout(toastTimer);
  setState({ toast: text });
  toastTimer = setTimeout(() => setState({ toast: '', flash: new Set() }), 4000);
}

function newOrderNo() {
  const letter = 'ABCDEFGHJKLMNPRSTUVWXYZ'[Math.floor(Math.random() * 23)];
  return `${letter}${String(Math.floor(Math.random() * 90) + 10)}`;
}

function finish(paidAtCounter) {
  clearTimeout(doneTimer);
  setState({ view: 'done', paidAtCounter });
  doneTimer = setTimeout(() => actions.reset(), DONE_MS);
}

const actions = {
  start: () => setState({ view: 'menu' }),
  go: (view) => setState({ view, showJson: false }),
  filter: (filter) => setState({ filter }),
  open: (id) => setState({ view: 'product', current: id, draft: { grind: GRINDS[0], qty: 1 } }),
  draft: (patch) => setState({ draft: { ...state.draft, ...patch } }),
  add: () => {
    const { grind, qty } = state.draft;
    const key = `${state.current}|${grind}`;
    const existing = state.cart.find((l) => l.key === key);
    const cart = existing
      ? state.cart.map((l) => (l.key === key ? { ...l, qty: Math.min(9, l.qty + qty) } : l))
      : [...state.cart, {
        key, id: state.current, grind, qty,
      }];
    const name = state.products.find((p) => p.id === state.current)?.name;
    setState({ cart, view: 'menu', current: null });
    showToast(`Added ${qty} × ${name}`);
  },
  qty: (key, qty) => setState({
    cart: qty < 1 ? state.cart.filter((l) => l.key !== key)
      : state.cart.map((l) => (l.key === key ? { ...l, qty: Math.min(9, qty) } : l)),
  }),
  checkout: () => {
    const orderNo = newOrderNo();
    const payUrl = `${SITE_URL}/our-roasts?order=${orderNo}&total=${total().toFixed(2)}`;
    setState({ view: 'pay', orderNo, payUrl });
  },
  paid: () => finish(false),
  payCounter: () => finish(true),
  reset: () => {
    clearTimeout(doneTimer);
    setState({
      ...initial,
      products: state.products,
      syncedAt: state.syncedAt,
      syncError: state.syncError,
      tier: state.tier,
    });
  },
  stay: () => {
    lastTouch = Date.now();
    setState({ idle: 0 });
  },
  toggleJson: (e) => {
    e?.stopPropagation();
    setState({ showJson: !state.showJson });
  },
  total,
};

/* ---- Content sync: poll, diff, and flash what changed ---- */
async function sync() {
  try {
    const products = await loadCatalogue(state.tier);
    const before = new Map(state.products.map((p) => [p.id, fingerprint(p)]));
    const changed = state.products.length
      ? products.filter((p) => before.get(p.id) !== fingerprint(p)) : [];
    const removed = state.products.filter((p) => !products.some((n) => n.id === p.id));
    const first = !state.products.length;
    if (!first && !changed.length && !removed.length && !state.syncError) {
      // Nothing new: update the clock only, so the screen never flickers.
      state = { ...state, products, syncedAt: Date.now() };
      return;
    }
    setState({
      products, syncedAt: Date.now(), syncError: false, flash: new Set(changed.map((p) => p.id)),
    });
    if (changed.length || removed.length) {
      const names = [...changed, ...removed].map((p) => p.name).join(', ');
      showToast(`Menu updated · ${names}`);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('kiosk: sync failed, keeping last menu', error);
    setState({ syncError: true });
    if (!state.products.length) stage.replaceChildren(statusPill(state, actions));
  }
}

/* ---- Idle handling ---- */
function onTouch() {
  lastTouch = Date.now();
  if (state.idle) setState({ idle: 0 });
}
['pointerdown', 'keydown'].forEach((t) => window.addEventListener(t, onTouch, { capture: true }));

setInterval(() => {
  const busy = !['attract', 'done'].includes(state.view);
  if (!busy) return;
  const remaining = IDLE_COUNTDOWN - Math.floor((Date.now() - lastTouch - IDLE_MS) / 1000);
  if (Date.now() - lastTouch < IDLE_MS) return;
  if (remaining <= 0) actions.reset();
  else setState({ idle: remaining });
}, 1000);

/* ---- Attract slideshow + status clock ---- */
setInterval(() => {
  if (state.view === 'attract') setState({ slide: state.slide + 1 });
}, SLIDE_MS);
setInterval(() => {
  const pill = stage.querySelector('.status');
  if (pill) pill.replaceWith(statusPill(state, actions));
}, 1000);

/* ---- Fit the 1080×1920 portrait stage to any screen ---- */
function fit() {
  const scale = Math.min(window.innerWidth / STAGE.w, window.innerHeight / STAGE.h);
  document.documentElement.style.setProperty('--scale', String(scale));
}
window.addEventListener('resize', fit);
fit();

/* ---- Keyboard shortcut for presenters: J toggles the JSON drawer ---- */
window.addEventListener('keydown', (e) => {
  if (e.key === 'j' || e.key === 'J') actions.toggleJson();
});

sync().then(() => setInterval(sync, POLL_MS));

/* ---- PWA: install to home screen, keep working offline ---- */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/kiosk/sw.js', { scope: '/kiosk/' }).catch((error) => {
    // eslint-disable-next-line no-console
    console.warn('kiosk: service worker not registered', error);
  });
}
