import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  collection, doc, getDocsFromServer, getFirestore, increment,
  serverTimestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { initWeather } from './weather.js';
import { initOverview } from './overview.js';
import { firebaseConfig } from './firebase-config.js';

const db = getFirestore(initializeApp(firebaseConfig));
const collections = { prices: 'marketPrices', weather: 'weatherRecords' };
const state = { prices: [], weather: [], view: 'overview', editing: null, busy: false };
const modal = new bootstrap.Modal(document.getElementById('record-modal'));
const toast = new bootstrap.Toast(document.getElementById('app-toast'), { delay: 4000 });
const overview = initOverview();
const weatherBoard = initWeather(db, notify, snapshot => overview.weather(snapshot));
const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

function el(id) { return document.getElementById(id); }
function clean(value) { return String(value ?? '').trim(); }
function slug(value) { return clean(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function today() { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); }
function dateLabel(value) { if (!value) return '—'; const d = new Date(value + 'T00:00:00'); return Number.isNaN(d.valueOf()) ? value : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }); }
function notify(message) { el('toast-message').textContent = message; toast.show(); }
function alertError(message) { const box = document.createElement('div'); box.className = 'alert alert-danger'; box.textContent = message; el('alert-area').replaceChildren(box); }
function clearError() { el('alert-area').replaceChildren(); }
function friendlyError(error) {
  if (error?.code === 'permission-denied') return 'Firestore denied access. Check the Security Rules for these collections and contentVersions.';
  if (error?.code === 'unavailable') return 'Firestore is unavailable. Check your connection and try again.';
  return error?.message || 'Something went wrong. Please try again.';
}

async function load(type) {
  const snapshot = await getDocsFromServer(collection(db, collections[type]));
  state[type] = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
  if (type === 'prices') overview.prices(state.prices);
}
let refreshing = false;
async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  try {
    const result = await Promise.allSettled([load('prices'), weatherBoard.refresh()]);
    const failures = result.filter(item => item.status === 'rejected');
    if (failures.length) alertError(friendlyError(failures[0].reason)); else clearError();
    render();
  } finally { refreshing = false; }
}
async function refreshType(type) {
  try { await load(type); clearError(); render(); }
  catch (error) { alertError(friendlyError(error)); }
}

function setView(view) {
  if (!['overview', 'prices', 'weather'].includes(view)) return;
  state.view = view;
  const titles = { overview: 'Overview', prices: 'Market Prices', weather: 'Weather' };
  el('page-title').textContent = titles[view];
  el('prices-controls').hidden = view !== 'prices';
  document.querySelector('.topbar').classList.toggle('market-topbar', view === 'prices');
  for (const type of ['overview', 'prices', 'weather']) el(type + '-panel').hidden = type !== view;
  document.querySelectorAll('.nav-item').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (view === 'weather') weatherBoard.enter();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function filtered(type) {
  const search = clean(el(type + '-search').value).toLowerCase();
  const showArchived = el(type + '-archived').checked;
  const category = type === 'prices' ? el('prices-category').value : '';
  return state[type].filter(item => (showArchived || item.isActive !== false) &&
    (!category || item.category === category) &&
    (!search || Object.values(item).some(value => typeof value === 'string' && value.toLowerCase().includes(search))))
    .sort((a, b) => type === 'prices' ? clean(a.commodityName).localeCompare(clean(b.commodityName)) : clean(a.forecastDate).localeCompare(clean(b.forecastDate)));
}
function categoryName(category) { return { fruit: 'Fruit', vegetable: 'Vegetable', spice: 'Spice' }[category] || 'Other'; }
function syncProductCategory(category) {
  const selected = ['fruit', 'vegetable', 'spice'].includes(category) ? category : 'fruit';
  field(el('prices-form'), 'category').value = selected;
  el('product-category-trigger').textContent = categoryName(selected);
  document.querySelectorAll('.product-category-option').forEach(option => {
    const active = option.dataset.productCategory === selected;
    option.classList.toggle('active', active);
    option.setAttribute('aria-pressed', String(active));
  });
}
function movement(item) {
  const previous = Number(item.previousAmount); const current = Number(item.amount);
  if (item.previousAmount == null || !Number.isFinite(previous) || previous <= 0 || !Number.isFinite(current)) return null;
  return { difference: current - previous, percent: (current - previous) / previous * 100 };
}
function marketRow(item) {
  const row = document.createElement('tr');
  const product = document.createElement('td');
  const name = document.createElement('button'); name.className = 'product-link'; name.type = 'button'; name.textContent = clean(item.commodityName) || 'Unnamed'; name.addEventListener('click', () => openForm('prices', item));
  const sub = document.createElement('small'); sub.textContent = item.isActive === false ? 'Deleted · Click to edit' : 'Davao del Sur · Click to edit';
  product.append(name, sub);
  const category = document.createElement('td'); const chip = document.createElement('span'); chip.className = 'category-chip ' + clean(item.category); chip.textContent = categoryName(item.category); category.append(chip);
  const change = document.createElement('td'); const move = movement(item); const badge = document.createElement('span');
  badge.className = 'movement ' + (move ? move.difference > 0 ? 'up' : move.difference < 0 ? 'down' : 'flat' : 'flat');
  badge.textContent = move ? (move.difference > 0 ? '▲ +' : move.difference < 0 ? '▼ ' : '— ') + Math.abs(move.percent).toFixed(1) + '%' : 'NEW';
  change.append(badge);
  if (move) { const difference = document.createElement('small'); difference.className = 'movement-detail'; difference.textContent = (move.difference > 0 ? '+' : '') + money.format(move.difference) + ' vs previous'; change.append(difference); }
  const price = document.createElement('td'); price.className = 'text-end'; const amount = document.createElement('strong'); amount.className = 'market-price'; amount.textContent = money.format(Number(item.amount) || 0); const unit = document.createElement('small'); unit.textContent = 'per kg'; price.append(amount, unit);
  row.append(product, category, change, price); return row;
}
function renderTable(type) {
  const body = el(type + '-body'); body.replaceChildren();
  const items = filtered(type); el(type + '-empty').hidden = items.length !== 0;
  body.closest('.table-responsive').hidden = items.length === 0;
  for (const item of items) body.append(marketRow(item));
}
function render() { renderTable('prices'); }

function field(form, name) { return form.elements.namedItem(name); }
function value(form, name) { return clean(field(form, name)?.value); }
function openForm(type, item = null) {
  state.editing = { type, id: item?.id || null };
  el('record-modal').dataset.type = type;
  el('modal-title').textContent = (item ? 'Edit ' : 'Add ') + (type === 'prices' ? 'product price' : 'forecast');
  el('prices-form').hidden = false;
  const form = el(type + '-form'); form.reset();
  if (item) for (const name of Object.keys(item)) { const input = field(form, name); if (input && 'value' in input) input.value = item[name] ?? ''; }
  if (type === 'prices') syncProductCategory(field(form, 'category').value);
  el('delete-button').hidden = type !== 'prices' || !item;
  if (type === 'prices' && item) el('delete-button').textContent = item.isActive === false ? 'Restore' : 'Delete';
  document.querySelector('#record-modal .modal-body').scrollTop = 0;
  modal.show();
}
function collectPrice(form) {
  const commodityName = value(form, 'commodityName');
  return {
    commodityName, cropId: slug(commodityName), category: value(form, 'category'),
    provinceName: 'Davao del Sur', priceType: 'retail', amount: Number(value(form, 'amount')), unit: 'kg',
    source: 'Demo data',
  };
}
function markChanged(batch, type) {
  batch.set(doc(db, 'contentVersions', type), { revision: increment(1), updatedAt: serverTimestamp() }, { merge: true });
}
async function saveRecord() {
  if (state.busy || !state.editing) return;
  const { type, id } = state.editing; const form = el(type + '-form');
  if (!form.reportValidity()) return;
  const data = collectPrice(form);
  if (type === 'prices' && data.amount <= 0) { alertError('Price must be greater than zero.'); return; }
  const existing = type === 'prices' && id ? state.prices.find(item => item.id === id) : null;
  if (type === 'prices' && !id && state.prices.some(item => item.id === data.cropId)) { alertError('This product already exists. Open its row to update the price.'); return; }
  if (type === 'prices') {
    data.previousAmount = existing ? (Number(existing.amount) === data.amount ? existing.previousAmount ?? null : Number(existing.amount)) : null;
    data.observedAt = existing && Number(existing.amount) === data.amount ? existing.observedAt || today() : today();
  }
  state.busy = true; el('save-button').disabled = true; el('save-button').textContent = 'Saving…';
  try {
    const batch = writeBatch(db);
    const ref = id ? doc(db, collections[type], id) : type === 'prices' ? doc(db, collections[type], data.cropId) : doc(collection(db, collections[type]));
    if (id) batch.update(ref, { ...data, updatedAt: serverTimestamp() });
    else batch.set(ref, { ...data, isActive: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), publishedAt: serverTimestamp() });
    markChanged(batch, type);
    await batch.commit();
    modal.hide(); clearError(); notify(id ? 'Record updated.' : 'Record added.');
    await refreshType(type);
  } catch (error) { alertError(friendlyError(error)); }
  finally { state.busy = false; el('save-button').disabled = false; el('save-button').textContent = 'Save record'; }
}
async function changePublished(type, item) {
  if (state.busy) return;
  const active = item.isActive !== false;
  if (active && !window.confirm('Delete this record? It can be restored from Show deleted.')) return;
  state.busy = true;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, collections[type], item.id), { isActive: !active, updatedAt: serverTimestamp(), deletedAt: active ? serverTimestamp() : null });
    markChanged(batch, type);
    await batch.commit();
    modal.hide(); notify(active ? 'Record deleted.' : 'Record restored.'); await refreshType(type);
  } catch (error) { alertError(friendlyError(error)); }
  finally { state.busy = false; }
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => openForm(button.dataset.add)));
for (const type of ['prices']) { el(type + '-search').addEventListener('input', () => renderTable(type)); el(type + '-archived').addEventListener('change', () => renderTable(type)); el(type + '-form').addEventListener('submit', event => { event.preventDefault(); saveRecord(); }); }
document.querySelectorAll('.category-option').forEach(button => button.addEventListener('click', () => {
  el('prices-category').value = button.dataset.category;
  document.querySelectorAll('.category-option').forEach(option => {
    const selected = option === button;
    option.classList.toggle('active', selected);
    option.setAttribute('aria-pressed', String(selected));
  });
  renderTable('prices');
  bootstrap.Dropdown.getOrCreateInstance(el('prices-filter-button')).hide();
}));
document.querySelectorAll('.product-category-option').forEach(button => button.addEventListener('click', () => {
  syncProductCategory(button.dataset.productCategory);
  bootstrap.Dropdown.getOrCreateInstance(el('product-category-trigger')).hide();
}));
el('save-button').addEventListener('click', saveRecord);
el('delete-button').addEventListener('click', () => { const { type, id } = state.editing || {}; const item = state[type]?.find(record => record.id === id); if (item) changePublished(type, item); });
window.addEventListener('online', refreshAll);
const pullIndicator = el('pull-indicator');
let pullStart = null;
let pullDistance = 0;
function resetPull() { pullStart = null; pullDistance = 0; pullIndicator.hidden = true; pullIndicator.style.transform = ''; }
document.addEventListener('touchstart', event => {
  if (event.touches.length !== 1 || window.innerWidth > 700 || window.scrollY > 0 || document.querySelector('.modal.show') || event.target.closest('input, select, textarea, button')) return;
  pullStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  pullDistance = 0;
}, { passive: true });
document.addEventListener('touchmove', event => {
  if (!pullStart || event.touches.length !== 1) return;
  const dx = event.touches[0].clientX - pullStart.x;
  const dy = event.touches[0].clientY - pullStart.y;
  if (dy <= 0 || Math.abs(dx) > dy) { resetPull(); return; }
  event.preventDefault();
  if (dy < 10) return;
  pullDistance = Math.min(100, dy * 0.55);
  pullIndicator.hidden = false;
  pullIndicator.textContent = pullDistance >= 65 ? 'Release to refresh' : 'Pull to refresh';
  pullIndicator.style.transform = 'translate(-50%, ' + Math.min(0, pullDistance - 70) + 'px)';
}, { passive: false });
document.addEventListener('touchend', async () => {
  if (!pullStart) return;
  const shouldRefresh = pullDistance >= 65;
  pullStart = null;
  if (shouldRefresh) {
    pullIndicator.textContent = 'Refreshing…';
    await refreshAll();
  }
  resetPull();
}, { passive: true });
document.addEventListener('touchcancel', resetPull, { passive: true });
refreshAll();
